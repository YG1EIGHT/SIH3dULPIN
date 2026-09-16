
"use client";

import React, {
  Suspense,
  useEffect,
  useMemo,
  useState,
} from "react";
import * as THREE from "three";
import { Canvas } from "@react-three/fiber";
import {
  ContactShadows,
  Environment,
  Grid,
  Html,
  OrbitControls,
} from "@react-three/drei";

import type {
  ParsedBuilding,
  Property2D,
} from "@/src/lib/parser/types";

import {
  getBuildingOrigin,
  getPolygonCenter,
  normalizePolygon,
} from "@/src/lib/coordinates";

// ============================================================
// TYPES
// ============================================================

type Point2DLike = {
  x: number;
  y: number;
};

type StyledProperty = Property2D & {
  spaceType?: string;
  heightMeters?: number;
  elevationMeters?: number;
};

// ============================================================
// SURVEYED FOOTPRINT
// ============================================================

type SurveyPoint = {
  lng: number;
  lat: number;
};

type SurveyFrame = {
  sw: SurveyPoint;
  nw: SurveyPoint;
  ne: SurveyPoint;
  se: SurveyPoint;
};

// Your current refined JSPM GeoJSON contains this surveyed
// quadrilateral. We use it as the orientation/reference frame
// for the 3D building.
//
// If the parser later exposes surveyedFootprintWGS84,
// that value will automatically be preferred.

const JSPM_SURVEY_FRAME: SurveyFrame = {
  sw: {
    lng: 73.8314905,
    lat: 18.4416833,
  },
  nw: {
    lng: 73.8314638,
    lat: 18.4418606,
  },
  ne: {
    lng: 73.8321389,
    lat: 18.441904,
  },
  se: {
    lng: 73.8321541,
    lat: 18.4417412,
  },
};

// ============================================================
// CONSTANTS
// ============================================================

const EARTH_RADIUS = 6378137;

const TARGET_BUILDING_WIDTH = 46.84;
const TARGET_BUILDING_DEPTH = 27.0;

const DEFAULT_FLOOR_HEIGHT = 3.2;

// ============================================================
// WARNING SUPPRESSION
// ============================================================

if (typeof window !== "undefined") {
  const originalWarn = console.warn;

  console.warn = (...args) => {
    if (
      typeof args[0] === "string" &&
      (
        args[0].includes(
          "THREE.Clock: This module has been deprecated"
        ) ||
        args[0].includes(
          "THREE.WebGLShadowMap: PCFSoftShadowMap has been deprecated"
        )
      )
    ) {
      return;
    }

    originalWarn(...args);
  };
}

// ============================================================
// GEOGRAPHIC DETECTION
// ============================================================

function isWgs84Point(
  point: Point2DLike
): boolean {
  if (
    !Number.isFinite(point.x) ||
    !Number.isFinite(point.y)
  ) {
    return false;
  }

  return (
    Math.abs(point.x) <= 180 &&
    Math.abs(point.y) <= 90 &&
    Math.abs(point.x) > 50 &&
    Math.abs(point.y) < 50
  );
}

// ============================================================
// WGS84 -> LOCAL METRES
// ============================================================

function geographicToMeters(
  lng: number,
  lat: number,
  originLng: number,
  originLat: number
): Point2DLike {
  const latRadians =
    (originLat * Math.PI) /
    180;

  const metersPerDegreeLat =
    (Math.PI * EARTH_RADIUS) /
    180;

  const metersPerDegreeLng =
    metersPerDegreeLat *
    Math.cos(latRadians);

  return {
    x:
      (lng - originLng) *
      metersPerDegreeLng,

    y:
      (lat - originLat) *
      metersPerDegreeLat,
  };
}

// ============================================================
// SURVEY FRAME
// ============================================================

function getSurveyFrame(
  building: ParsedBuilding
): SurveyFrame {
  const runtimeFrame = (
    building as ParsedBuilding & {
      georeference?: {
        latitude: number;
        longitude: number;
        surveyedFootprintWGS84?: {
          type: string;
          coordinates: number[][][];
        };
      };
    }
  ).georeference
    ?.surveyedFootprintWGS84;

  if (
    runtimeFrame?.coordinates?.[0]
      ?.length >= 4
  ) {
    const ring =
      runtimeFrame.coordinates[0];

    // GeoJSON is normally supplied around
    // the polygon in a consecutive ring.
    //
    // Determine corners using geographic
    // extremes rather than assuming exact order.

    const points = ring
      .slice(
        0,
        ring.length - 1
      )
      .map(
        ([lng, lat]) => ({
          lng,
          lat,
        })
      );

    const sortedByLat = [
      ...points,
    ].sort(
      (a, b) =>
        b.lat - a.lat
    );

    const north =
      sortedByLat.slice(0, 2);

    const south =
      sortedByLat.slice(2, 4);

    const nw =
      north.reduce(
        (a, b) =>
          a.lng < b.lng
            ? a
            : b
      );

    const ne =
      north.reduce(
        (a, b) =>
          a.lng > b.lng
            ? a
            : b
      );

    const sw =
      south.reduce(
        (a, b) =>
          a.lng < b.lng
            ? a
            : b
      );

    const se =
      south.reduce(
        (a, b) =>
          a.lng > b.lng
            ? a
            : b
      );

    return {
      sw,
      nw,
      ne,
      se,
    };
  }

  return JSPM_SURVEY_FRAME;
}

// ============================================================
// SURVEY FRAME -> METRE VECTORS
// ============================================================

function surveyFrameToMeters(
  frame: SurveyFrame
) {
  const origin = frame.sw;

  const sw = {
    x: 0,
    y: 0,
  };

  const nw =
    geographicToMeters(
      frame.nw.lng,
      frame.nw.lat,
      origin.lng,
      origin.lat
    );

  const se =
    geographicToMeters(
      frame.se.lng,
      frame.se.lat,
      origin.lng,
      origin.lat
    );

  const ne =
    geographicToMeters(
      frame.ne.lng,
      frame.ne.lat,
      origin.lng,
      origin.lat
    );

  return {
    sw,
    nw,
    ne,
    se,
  };
}

// ============================================================
// BILINEAR INVERSE
// ============================================================

/**
 * Finds normalized (u,v) coordinates inside the
 * surveyed quadrilateral.
 *
 * u = 0 -> west
 * u = 1 -> east
 *
 * v = 0 -> south
 * v = 1 -> north
 *
 * This is what prevents the east/west half of the
 * structure from appearing displaced when the survey
 * footprint is rotated/skewed.
 */
function inverseBilinear(
  point: Point2DLike,
  frame: {
    sw: Point2DLike;
    nw: Point2DLike;
    ne: Point2DLike;
    se: Point2DLike;
  }
): Point2DLike {
  const x0 = frame.sw.x;
  const y0 = frame.sw.y;

  const ax =
    frame.se.x -
    frame.sw.x;

  const ay =
    frame.se.y -
    frame.sw.y;

  const bx =
    frame.nw.x -
    frame.sw.x;

  const by =
    frame.nw.y -
    frame.sw.y;

  const cx =
    frame.sw.x -
    frame.se.x -
    frame.nw.x +
    frame.ne.x;

  const cy =
    frame.sw.y -
    frame.se.y -
    frame.nw.y +
    frame.ne.y;

  const px =
    point.x - x0;

  const py =
    point.y - y0;

  // Initial affine estimate.
  const determinant =
    ax * by -
    ay * bx;

  let u =
    determinant !== 0
      ? (px * by -
          py * bx) /
        determinant
      : 0.5;

  let v =
    determinant !== 0
      ? (ax * py -
          ay * px) /
        determinant
      : 0.5;

  // Refine using Newton-Raphson.
  for (
    let i = 0;
    i < 8;
    i++
  ) {
    const fx =
      x0 +
      ax * u +
      bx * v +
      cx * u * v -
      point.x;

    const fy =
      y0 +
      ay * u +
      by * v +
      cy * u * v -
      point.y;

    const j11 =
      ax + cx * v;

    const j12 =
      bx + cx * u;

    const j21 =
      ay + cy * v;

    const j22 =
      by + cy * u;

    const determinantJ =
      j11 * j22 -
      j12 * j21;

    if (
      Math.abs(
        determinantJ
      ) < 1e-10
    ) {
      break;
    }

    const du =
      (
        fx * j22 -
        j12 * fy
      ) /
      determinantJ;

    const dv =
      (
        j11 * fy -
        fx * j21
      ) /
      determinantJ;

    u -= du;
    v -= dv;
  }

  return {
    x: u,
    y: v,
  };
}

// ============================================================
// GEOGRAPHIC POLYGON -> SURVEY LOCAL
// ============================================================

function convertGeographicPolygon(
  polygon: Point2DLike[],
  surveyFrame: SurveyFrame
): Point2DLike[] {
  const metreFrame =
    surveyFrameToMeters(
      surveyFrame
    );

  const origin =
    surveyFrame.sw;

  return polygon.map(
    (point) => {
      const meterPoint =
        geographicToMeters(
          point.x,
          point.y,
          origin.lng,
          origin.lat
        );

      const uv =
        inverseBilinear(
          meterPoint,
          metreFrame
        );

      // Map the surveyed quadrilateral
      // to the refined architectural envelope.
      return {
        x:
          (
            uv.x -
            0.5
          ) *
          TARGET_BUILDING_WIDTH,

        y:
          (
            uv.y -
            0.5
          ) *
          TARGET_BUILDING_DEPTH,
      };
    }
  );
}

// ============================================================
// POLYGON CONVERTER
// ============================================================

function convertPolygonToScene(
  polygon: Point2DLike[],
  surveyFrame: SurveyFrame
): Point2DLike[] {
  if (
    !polygon ||
    polygon.length < 3
  ) {
    return [];
  }

  if (
    isWgs84Point(
      polygon[0]
    )
  ) {
    return convertGeographicPolygon(
      polygon,
      surveyFrame
    );
  }

  // Existing local-metre cadastral
  // files continue to work.
  return polygon.map(
    (point) => ({
      x: point.x,
      y: point.y,
    })
  );
}

// ============================================================
// SPACE STYLE
// ============================================================

function getSpaceStyle(
  property: StyledProperty
) {
  const name =
    (
      property.unitNumber ||
      ""
    ).toLowerCase();

  const type =
    (
      property.spaceType ||
      ""
    ).toLowerCase();

  if (
    name.includes("stair") ||
    type.includes("stair")
  ) {
    return {
      fillColor:
        "#f97316",
      wireColor:
        "#c2410c",
      label:
        property.unitNumber ||
        "STAIRWELL",
      type: "stairs",
      opacity: 0.9,
    };
  }

  if (
    name.includes("lift") ||
    name.includes(
      "elevator"
    ) ||
    type.includes("lift") ||
    type.includes(
      "elevator"
    )
  ) {
    return {
      fillColor:
        "#06b6d4",
      wireColor:
        "#0e7490",
      label:
        property.unitNumber ||
        "ELEVATOR",
      type: "lift",
      opacity: 0.92,
    };
  }

  if (
    name.includes(
      "passage"
    ) ||
    name.includes(
      "corridor"
    ) ||
    type.includes(
      "passage"
    ) ||
    type.includes(
      "corridor"
    )
  ) {
    return {
      fillColor:
        "#a855f7",
      wireColor:
        "#7e22ce",
      label:
        property.unitNumber ||
        "CORRIDOR",
      type: "passage",
      opacity: 0.5,
    };
  }

  if (
    name.includes("w/c") ||
    name.includes(
      "toilet"
    ) ||
    name.includes(
      "ladies"
    ) ||
    name.includes(
      "gents"
    ) ||
    type.includes(
      "restroom"
    ) ||
    type.includes(
      "toilet"
    )
  ) {
    return {
      fillColor:
        "#ec4899",
      wireColor:
        "#be185d",
      label:
        property.unitNumber ||
        "RESTROOM",
      type: "restroom",
      opacity: 0.72,
    };
  }

  return {
    fillColor:
      "#3b82f6",
    wireColor:
      "#1e3a8a",
    label:
      property.unitNumber ||
      "UNIT",
    type: "room",
    opacity: 0.48,
  };
}

// ============================================================
// MAIN VIEWER
// ============================================================

export default function VolumetricViewer({
  building,
  selectedPropertyId,
  onPropertySelect,
}: {
  building: ParsedBuilding;
  selectedPropertyId?: string | null;
  onPropertySelect?: (
    property: Property2D
  ) => void;
}) {
  const [selected, setSelected] =
    useState<Property2D | null>(
      null
    );

  // ----------------------------------------------------------
  // Survey frame
  // ----------------------------------------------------------

  const surveyFrame =
    useMemo(
      () =>
        getSurveyFrame(
          building
        ),
      [building]
    );

  // ----------------------------------------------------------
  // Convert all geometry using ONE common
  // surveyed reference frame.
  // ----------------------------------------------------------

  const sceneBuilding =
    useMemo(() => {
      return building.floors.map(
        (floor) => ({
          ...floor,

          units:
            floor.units.map(
              (unit) => ({
                ...unit,

                polygon:
                  convertPolygonToScene(
                    unit.polygon,
                    surveyFrame
                  ),
              })
            ),
        })
      );
    }, [
      building,
      surveyFrame,
    ]);

  // ----------------------------------------------------------
  // All scene polygons
  // ----------------------------------------------------------

  const polygons =
    useMemo(() => {
      return sceneBuilding.flatMap(
        (floor) =>
          floor.units
            .map(
              (unit) =>
                unit.polygon
            )
            .filter(
              (polygon) =>
                polygon.length >= 3
            )
      );
    }, [sceneBuilding]);

  // ----------------------------------------------------------
  // Common center
  // ----------------------------------------------------------

  const origin =
    useMemo(
      () =>
        getBuildingOrigin(
          polygons
        ),
      [polygons]
    );

  // ----------------------------------------------------------
  // Center the COMPLETE building.
  //
  // No individual unit is shifted.
  // ----------------------------------------------------------

  const centeredBuilding =
    useMemo(() => {
      return sceneBuilding.map(
        (floor) => ({
          ...floor,

          units:
            floor.units.map(
              (unit) => ({
                ...unit,

                polygon:
                  normalizePolygon(
                    unit.polygon,
                    origin
                  ),
              })
            ),
        })
      );
    }, [
      sceneBuilding,
      origin,
    ]);

  // ----------------------------------------------------------
  // Dimensions
  // ----------------------------------------------------------

  const dimensions =
    useMemo(() => {
      const points =
        centeredBuilding.flatMap(
          (floor) =>
            floor.units.flatMap(
              (unit) =>
                unit.polygon
            )
        );

      if (!points.length) {
        return {
          width: TARGET_BUILDING_WIDTH,
          depth: TARGET_BUILDING_DEPTH,
          diagonal: 54,
        };
      }

      const xs =
        points.map(
          (p) => p.x
        );

      const ys =
        points.map(
          (p) => p.y
        );

      const width =
        Math.max(...xs) -
        Math.min(...xs);

      const depth =
        Math.max(...ys) -
        Math.min(...ys);

      const safeWidth =
        Math.max(
          width,
          1
        );

      const safeDepth =
        Math.max(
          depth,
          1
        );

      return {
        width:
          safeWidth,
        depth:
          safeDepth,
        diagonal:
          Math.sqrt(
            safeWidth *
              safeWidth +
              safeDepth *
                safeDepth
          ),
      };
    }, [
      centeredBuilding,
    ]);

  // ----------------------------------------------------------
  // Total vertical height
  // ----------------------------------------------------------

  const totalHeight =
    useMemo(() => {
      if (
        !centeredBuilding.length
      ) {
        return 16;
      }

      return Math.max(
        ...centeredBuilding.map(
          (floor) =>
            Number(
              floor.elevation ??
                0
            ) +
            Number(
              floor.height ||
                DEFAULT_FLOOR_HEIGHT
            )
        ),
        16
      );
    }, [
      centeredBuilding,
    ]);

  // ----------------------------------------------------------
  // Selection
  // ----------------------------------------------------------

  useEffect(() => {
    if (
      !selectedPropertyId
    ) {
      setSelected(null);
      return;
    }

    const match =
      building.floors
        .flatMap(
          (floor) =>
            floor.units
        )
        .find(
          (unit) =>
            String(
              unit.id
            ) ===
            String(
              selectedPropertyId
            )
        );

    setSelected(
      match || null
    );
  }, [
    selectedPropertyId,
    building,
  ]);

  // ----------------------------------------------------------
  // Camera
  // ----------------------------------------------------------

  const cameraPosition =
    useMemo(() => {
      const horizontal =
        Math.max(
          dimensions.diagonal *
            1.3,
          45
        );

      return [
        horizontal,
        Math.max(
          totalHeight *
            1.15,
          dimensions.depth,
          24
        ),
        horizontal,
      ] as [
        number,
        number,
        number
      ];
    }, [
      dimensions,
      totalHeight,
    ]);

  const hasGeometry =
    centeredBuilding.some(
      (floor) =>
        floor.units.some(
          (unit) =>
            unit.polygon
              .length >= 3
        )
    );

  return (
    <div
      style={{
        width: "100%",
        height: "650px",
        position:
          "relative",
        overflow:
          "hidden",
        borderRadius:
          "14px",
        border:
          "1px solid #cbd5e1",
        background:
          "#f8fafc",
      }}
    >
      <Canvas
        shadows
        dpr={[1, 2]}
        camera={{
          position:
            cameraPosition,
          fov: 42,
          near: 0.1,
          far: 5000,
        }}
      >
        {/* =================================================
            BACKGROUND
        ================================================= */}

        <color
          attach="background"
          args={[
            "#f8fafc",
          ]}
        />

        {/* =================================================
            LIGHTING
        ================================================= */}

        <ambientLight
          intensity={0.86}
        />

        <hemisphereLight
          args={[
            "#ffffff",
            "#cbd5e1",
            0.62,
          ]}
          position={[
            0,
            80,
            0,
          ]}
        />

        <directionalLight
          position={[
            dimensions.width,
            totalHeight *
              2,
            dimensions.depth,
          ]}
          intensity={1.65}
          castShadow
          shadow-mapSize-width={
            2048
          }
          shadow-mapSize-height={
            2048
          }
        />

        <pointLight
          position={[
            -dimensions.width,
            totalHeight,
            -dimensions.depth,
          ]}
          intensity={0.42}
        />

        <Suspense
          fallback={null}
        >
          <Environment
            preset="city"
          />
        </Suspense>

        {/* =================================================
            BUILDING
        ================================================= */}

        {hasGeometry && (
          <group>
            {centeredBuilding.map(
              (floor) => {
                const elevation =
                  Number(
                    floor.elevation
                  ) || 0;

                const floorHeight =
                  Number(
                    floor.height
                  ) ||
                  DEFAULT_FLOOR_HEIGHT;

                return (
                  <group
                    key={`floor-${floor.floorNumber}`}
                  >
                    <FloorSlab
                      units={
                        floor.units
                      }
                      elevation={
                        elevation
                      }
                    />

                    {floor.units.map(
                      (unit) => (
                        <PropertyVolume
                          key={
                            unit.id
                          }
                          property={
                            unit as StyledProperty
                          }
                          elevation={
                            elevation
                          }
                          height={
                            Number(
                              (
                                unit as StyledProperty
                              )
                                .heightMeters
                            ) ||
                            floorHeight
                          }
                          selected={
                            selected?.id ===
                            unit.id
                          }
                          onSelect={() => {
                            setSelected(
                              unit
                            );

                            onPropertySelect?.(
                              unit
                            );
                          }}
                        />
                      )
                    )}
                  </group>
                );
              }
            )}
          </group>
        )}

        {/* =================================================
            GROUND
        ================================================= */}

        <ContactShadows
          position={[
            0,
            -0.08,
            0,
          ]}
          opacity={0.34}
          scale={Math.max(
            dimensions.diagonal *
              2.4,
            90
          )}
          blur={1.6}
          far={Math.max(
            totalHeight * 2,
            35
          )}
        />

        <Grid
          position={[
            0,
            -0.1,
            0,
          ]}
          args={[
            Math.max(
              dimensions.width *
                2.8,
              70
            ),
            Math.max(
              dimensions.depth *
                3.8,
              70
            ),
          ]}
          cellSize={1}
          cellThickness={0.55}
          cellColor="#cbd5e1"
          sectionSize={5}
          sectionThickness={1.1}
          sectionColor="#94a3b8"
          fadeDistance={120}
          fadeStrength={1}
          infiniteGrid
        />

        {/* =================================================
            CONTROLS
        ================================================= */}

        <OrbitControls
          makeDefault
          enableDamping
          dampingFactor={0.08}
          rotateSpeed={0.7}
          zoomSpeed={0.85}
          panSpeed={0.7}
          minDistance={Math.max(
            dimensions.diagonal *
              0.24,
            7
          )}
          maxDistance={Math.max(
            dimensions.diagonal *
              7,
            140
          )}
          minPolarAngle={0.12}
          maxPolarAngle={
            Math.PI / 2 -
            0.03
          }
          target={[
            0,
            totalHeight / 2,
            0,
          ]}
        />
      </Canvas>

      {/* ======================================================
          HEADER
      ====================================================== */}

      <div
        style={{
          position:
            "absolute",
          top: "18px",
          left: "18px",
          zIndex: 10,
          padding:
            "12px 16px",
          borderRadius:
            "9px",
          background:
            "rgba(255,255,255,0.96)",
          border:
            "1px solid #cbd5e1",
          boxShadow:
            "0 4px 15px rgba(0,0,0,0.08)",
          backdropFilter:
            "blur(6px)",
        }}
      >
        <div
          style={{
            fontSize:
              "10px",
            color:
              "#2563eb",
            fontWeight:
              800,
            letterSpacing:
              "0.8px",
          }}
        >
          3D CADASTRAL MODEL
        </div>

        <div
          style={{
            marginTop:
              "3px",
            fontSize:
              "17px",
            fontWeight:
              800,
            color:
              "#0f172a",
          }}
        >
          {building.name}
        </div>

        <div
          style={{
            marginTop:
              "4px",
            fontSize:
              "10px",
            color:
              "#64748b",
          }}
        >
          {dimensions.width.toFixed(
            1
          )}
          m ×{" "}
          {dimensions.depth.toFixed(
            1
          )}
          m ×{" "}
          {totalHeight.toFixed(
            1
          )}
          m
        </div>
      </div>

      {/* ======================================================
          EMPTY STATE
      ====================================================== */}

      {!hasGeometry && (
        <div
          style={{
            position:
              "absolute",
            inset: 0,
            display:
              "flex",
            alignItems:
              "center",
            justifyContent:
              "center",
            pointerEvents:
              "none",
          }}
        >
          <div
            style={{
              padding:
                "14px 18px",
              borderRadius:
                "10px",
              background:
                "rgba(255,255,255,0.96)",
              border:
                "1px solid #f59e0b",
              color:
                "#92400e",
              fontSize:
                "12px",
              fontWeight:
                700,
            }}
          >
            No valid cadastral
            polygon geometry
            was received.
          </div>
        </div>
      )}

      {/* ======================================================
          SELECTED PROPERTY
      ====================================================== */}

      {selected && (
        <div
          style={{
            position:
              "absolute",
            top: "18px",
            right: "18px",
            zIndex: 20,
            width:
              "280px",
            padding:
              "18px",
            borderRadius:
              "11px",
            background:
              "rgba(255,255,255,0.98)",
            border:
              "1.5px solid #2563eb",
            boxShadow:
              "0 8px 25px rgba(0,0,0,0.12)",
            backdropFilter:
              "blur(8px)",
          }}
        >
          <div
            style={{
              fontSize:
                "10px",
              fontWeight:
                800,
              color:
                "#2563eb",
              letterSpacing:
                "0.7px",
            }}
          >
            SELECTED PROPERTY
          </div>

          <div
            style={{
              marginTop:
                "5px",
              fontSize:
                "20px",
              fontWeight:
                800,
              color:
                "#0f172a",
            }}
          >
            {
              selected.unitNumber
            }
          </div>

          <div
            style={{
              marginTop:
                "16px",
              display:
                "grid",
              gap: "10px",
            }}
          >
            <PropertyInfo
              label="Property ID"
              value={
                selected.id
              }
            />

            <PropertyInfo
              label="Floor Level"
              value={`Floor ${selected.floorNumber}`}
            />

            <PropertyInfo
              label="Usable Area"
              value={`${selected.area} m²`}
            />

            <PropertyInfo
              label="Clear Height"
              value="3.2 m"
            />

            <PropertyInfo
              label="3D ULPIN Identifier"
              value={
                selected.ulpin ||
                `3D-${building.id}-F${String(
                  selected.floorNumber
                ).padStart(
                  2,
                  "0"
                )}-${selected.unitNumber}`
              }
            />
          </div>

          <button
            type="button"
            onClick={() =>
              setSelected(null)
            }
            style={{
              width:
                "100%",
              marginTop:
                "16px",
              padding:
                "8px",
              borderRadius:
                "7px",
              border:
                "1px solid #cbd5e1",
              background:
                "#f1f5f9",
              color:
                "#0f172a",
              cursor:
                "pointer",
              fontWeight:
                700,
            }}
          >
            Close Inspector
          </button>
        </div>
      )}

      {/* ======================================================
          INSTRUCTION
      ====================================================== */}

      {!selected && (
        <div
          style={{
            position:
              "absolute",
            bottom: "18px",
            left: "18px",
            zIndex: 10,
            padding:
              "8px 12px",
            borderRadius:
              "7px",
            background:
              "rgba(255,255,255,0.93)",
            border:
              "1px solid #cbd5e1",
            fontSize:
              "11px",
            color:
              "#475569",
          }}
        >
          Click a room,
          laboratory,
          stairwell or
          lift to inspect
          its 3D ULPIN.
        </div>
      )}

      {/* ======================================================
          STATS
      ====================================================== */}

      <div
        style={{
          position:
            "absolute",
          bottom: "18px",
          right: "18px",
          zIndex: 10,
          padding:
            "8px 12px",
          borderRadius:
            "7px",
          background:
            "rgba(255,255,255,0.93)",
          border:
            "1px solid #cbd5e1",
          fontSize:
            "10px",
          color:
            "#475569",
        }}
      >
        {building.floors.length}{" "}
        floors ·{" "}
        {building.floors.reduce(
          (total, floor) =>
            total +
            floor.units.length,
          0
        )}{" "}
        spaces
      </div>
    </div>
  );
}

// ============================================================
// FLOOR SLAB
// ============================================================

function FloorSlab({
  units,
  elevation,
}: {
  units: Property2D[];
  elevation: number;
}) {
  const bounds =
    useMemo(() => {
      const points =
        units.flatMap(
          (unit) =>
            unit.polygon
        );

      if (!points.length) {
        return null;
      }

      const xs =
        points.map(
          (p) => p.x
        );

      const ys =
        points.map(
          (p) => p.y
        );

      return {
        minX:
          Math.min(...xs) -
          0.12,

        maxX:
          Math.max(...xs) +
          0.12,

        minY:
          Math.min(...ys) -
          0.12,

        maxY:
          Math.max(...ys) +
          0.12,
      };
    }, [units]);

  if (!bounds) {
    return null;
  }

  return (
    <mesh
      position={[
        (bounds.minX +
          bounds.maxX) /
          2,

        elevation -
          0.045,

        (bounds.minY +
          bounds.maxY) /
          2,
      ]}
      rotation={[
        -Math.PI / 2,
        0,
        0,
      ]}
      receiveShadow
    >
      <planeGeometry
        args={[
          bounds.maxX -
            bounds.minX,
          bounds.maxY -
            bounds.minY,
        ]}
      />

      <meshStandardMaterial
        color="#dbe4ee"
        roughness={0.82}
        transparent
        opacity={0.72}
        side={
          THREE.DoubleSide
        }
      />
    </mesh>
  );
}

// ============================================================
// PROPERTY VOLUME
// ============================================================

function PropertyVolume({
  property,
  elevation,
  height,
  selected,
  onSelect,
}: {
  property: StyledProperty;
  elevation: number;
  height: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const polygon =
    property.polygon;

  const center =
    useMemo(
      () =>
        getPolygonCenter(
          polygon
        ),
      [polygon]
    );

  const style =
    useMemo(
      () =>
        getSpaceStyle(
          property
        ),
      [property]
    );

  const dimensions =
    useMemo(() => {
      if (!polygon.length) {
        return {
          width: 1,
          depth: 1,
        };
      }

      const xs =
        polygon.map(
          (p) => p.x
        );

      const ys =
        polygon.map(
          (p) => p.y
        );

      return {
        width: Math.max(
          Math.max(...xs) -
            Math.min(...xs),
          0.5
        ),

        depth: Math.max(
          Math.max(...ys) -
            Math.min(...ys),
          0.5
        ),
      };
    }, [polygon]);

  const geometry =
    useMemo(() => {
      if (
        polygon.length < 3
      ) {
        return null;
      }

      const shape =
        new THREE.Shape();

      polygon.forEach(
        (
          point,
          index
        ) => {
          const x =
            point.x -
            center.x;

          const y =
            point.y -
            center.y;

          if (
            index === 0
          ) {
            shape.moveTo(
              x,
              y
            );
          } else {
            shape.lineTo(
              x,
              y
            );
          }
        }
      );

      shape.closePath();

      const geo =
        new THREE.ExtrudeGeometry(
          shape,
          {
            depth:
              Math.max(
                height,
                0.5
              ),
            bevelEnabled:
              false,
            steps: 1,
            curveSegments: 1,
          }
        );

      geo.computeVertexNormals();

      return geo;
    }, [
      polygon,
      center,
      height,
    ]);

  if (!geometry) {
    return null;
  }

  return (
    <group
      position={[
        center.x,
        elevation +
          height / 2,
        center.y,
      ]}
    >
      {/* ================================================
          STAIRS
      ================================================= */}

      {style.type ===
        "stairs" && (
        <StairStepsMesh
          width={
            dimensions.width
          }
          depth={
            dimensions.depth
          }
          height={
            height
          }
          color={
            style.fillColor
          }
        />
      )}

      {/* ================================================
          LIFT
      ================================================= */}

      {style.type ===
        "lift" && (
        <ElevatorShaftMesh
          width={
            dimensions.width
          }
          depth={
            dimensions.depth
          }
          height={
            height
          }
          color={
            style.fillColor
          }
        />
      )}

      {/* ================================================
          PROPERTY VOLUME
      ================================================= */}

      <group
        rotation={[
          -Math.PI / 2,
          0,
          0,
        ]}
      >
        <mesh
          geometry={
            geometry
          }
          castShadow
          receiveShadow
          onClick={(
            event
          ) => {
            event.stopPropagation();
            onSelect();
          }}
        >
          <meshStandardMaterial
            color={
              selected
                ? "#f59e0b"
                : style.fillColor
            }
            transparent
            opacity={
              selected
                ? 0.92
                : style.opacity
            }
            roughness={0.3}
            metalness={0.03}
            side={
              THREE.DoubleSide
            }
          />
        </mesh>

        <lineSegments
          onClick={(
            event
          ) => {
            event.stopPropagation();
            onSelect();
          }}
        >
          <edgesGeometry
            args={[
              geometry,
            ]}
          />

          <lineBasicMaterial
            color={
              selected
                ? "#b45309"
                : style.wireColor
            }
            linewidth={
              selected
                ? 2.5
                : 1.15
            }
          />
        </lineSegments>
      </group>

      {/* ================================================
          LABEL
      ================================================= */}

      {(
        selected ||
        style.type ===
          "stairs" ||
        style.type ===
          "lift"
      ) && (
        <Html
          position={[
            0,
            height / 2 +
              0.6,
            0,
          ]}
          center
          distanceFactor={24}
        >
          <div
            style={{
              padding:
                "4px 8px",
              background:
                "#ffffff",
              border:
                `1.5px solid ${
                  selected
                    ? "#d97706"
                    : style.fillColor
                }`,
              borderRadius:
                "5px",
              boxShadow:
                "0 4px 12px rgba(0,0,0,0.15)",
              whiteSpace:
                "nowrap",
              fontSize:
                "10px",
              fontWeight:
                800,
              color:
                "#0f172a",
              pointerEvents:
                "none",
            }}
          >
            {style.label}
          </div>
        </Html>
      )}
    </group>
  );
}

// ============================================================
// STAIRS
// ============================================================

function StairStepsMesh({
  width,
  depth,
  height,
  color,
}: {
  width: number;
  depth: number;
  height: number;
  color: string;
}) {
  const stepCount = 8;

  const stepHeight =
    Math.max(
      height /
        stepCount,
      0.1
    );

  const stepDepth =
    Math.max(
      depth /
        stepCount,
      0.2
    );

  return (
    <group
      position={[
        0,
        -height / 2,
        0,
      ]}
    >
      {Array.from({
        length:
          stepCount,
      }).map(
        (_, index) => (
          <mesh
            key={`stair-step-${index}`}
            position={[
              0,

              index *
                  stepHeight +
                stepHeight / 2,

              -depth / 2 +
                index *
                  stepDepth +
                stepDepth / 2,
            ]}
            castShadow
          >
            <boxGeometry
              args={[
                Math.max(
                  width *
                    0.88,
                  0.6
                ),
                stepHeight,
                stepDepth,
              ]}
            />

            <meshStandardMaterial
              color={
                color
              }
              roughness={
                0.48
              }
            />
          </mesh>
        )
      )}
    </group>
  );
}

// ============================================================
// ELEVATOR
// ============================================================

function ElevatorShaftMesh({
  width,
  depth,
  height,
  color,
}: {
  width: number;
  depth: number;
  height: number;
  color: string;
}) {
  return (
    <mesh castShadow>
      <boxGeometry
        args={[
          Math.max(
            width *
              0.72,
            0.8
          ),

          Math.max(
            height *
              0.82,
            0.8
          ),

          Math.max(
            depth *
              0.72,
            0.8
          ),
        ]}
      />

      <meshStandardMaterial
        color={
          color
        }
        emissive={
          color
        }
        emissiveIntensity={
          0.18
        }
        roughness={
          0.25
        }
      />
    </mesh>
  );
}

// ============================================================
// PROPERTY INFO
// ============================================================

function PropertyInfo({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div>
      <div
        style={{
          fontSize:
            "9px",
          color:
            "#64748b",
          fontWeight:
            700,
          letterSpacing:
            "0.3px",
        }}
      >
        {label}
      </div>

      <div
        style={{
          marginTop:
            "2px",
          fontSize:
            "12px",
          fontWeight:
            600,
          color:
            "#0f172a",
          wordBreak:
            "break-word",
        }}
      >
        {value}
      </div>
    </div>
  );
}

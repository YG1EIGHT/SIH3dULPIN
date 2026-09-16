
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Map,
  NavigationControl,
  ScaleControl,
  Popup,
  LngLatBounds,
  Marker,
  setWorkerUrl,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import type {
  ParsedBuilding,
  Property2D,
} from "@/src/lib/parser/types";

setWorkerUrl(
  "/maplibre/maplibre-gl-worker.mjs"
);

/* ============================================================
   TYPES
   ============================================================ */

interface RealWorldMapViewerProps {
  /**
   * Single-building mode.
   */
  building?: ParsedBuilding | null;

  /**
   * Multi-building mode.
   *
   * Used by Public Viewer.
   */
  buildings?: ParsedBuilding[];

  approvalStatus?:
    | "PENDING_REVIEW"
    | "APPROVED"
    | "REJECTED"
    | string;

  onPropertySelect?: (
    property: Property2D
  ) => void;

  onPropertyNavigate?: (
    property: Property2D
  ) => void;

  onBuildingSelect?: (
    building: ParsedBuilding
  ) => void;
}

type PointLike =
  | Point2D
  | [number, number]
  | {
      x?: number;
      y?: number;
      lng?: number;
      lat?: number;
    };

interface Point2D {
  x: number;
  y: number;
}

/* ============================================================
   IDS
   ============================================================ */

const SOURCE_ID =
  "ulpin-cadastral-source";

const FOOTPRINT_LAYER =
  "ulpin-cadastral-footprints";

const EXTRUSION_LAYER =
  "ulpin-cadastral-extrusions";

const OUTLINE_LAYER =
  "ulpin-cadastral-outlines";

/* ============================================================
   HELPERS
   ============================================================ */

/**
 * Parse a possible JSON string safely.
 */
function parseMaybeJSON<T>(
  value: unknown,
  fallback: T
): T {
  if (
    value === null ||
    value === undefined
  ) {
    return fallback;
  }

  if (
    typeof value !== "string"
  ) {
    return value as T;
  }

  try {
    return JSON.parse(
      value
    ) as T;
  } catch {
    return fallback;
  }
}

/**
 * Extract x/y from different possible point shapes.
 */
function getXY(
  point: PointLike
): [number, number] {
  if (
    Array.isArray(point)
  ) {
    return [
      Number(point[0]) || 0,
      Number(point[1]) || 0,
    ];
  }

  return [
    Number(
      point.x ??
        point.lng ??
        0
    ) || 0,

    Number(
      point.y ??
        point.lat ??
        0
    ) || 0,
  ];
}

/**
 * A local floor-plan coordinate can easily be:
 *
 * [6,0]
 * [8,27]
 *
 * so merely checking the valid longitude/latitude range
 * is NOT enough.
 */
function isProbablyGeographic(
  points: PointLike[],
  anchorLng: number,
  anchorLat: number
) {
  if (
    !points.length
  ) {
    return false;
  }

  /**
   * Geographic polygon should be near the anchor.
   */
  return points.every(
    (point) => {
      const [x, y] =
        getXY(point);

      return (
        x >= -180 &&
        x <= 180 &&
        y >= -90 &&
        y <= 90 &&
        Math.abs(
          x - anchorLng
        ) < 0.05 &&
        Math.abs(
          y - anchorLat
        ) < 0.05
      );
    }
  );
}

/**
 * Convert local metre offsets into WGS84.
 */
function localToLngLat(
  x: number,
  y: number,
  anchorLng: number,
  anchorLat: number
): [number, number] {
  const metersPerDegreeLat =
    111320;

  const metersPerDegreeLng =
    111320 *
    Math.cos(
      (anchorLat *
        Math.PI) /
        180
    );

  return [
    anchorLng +
      x /
        metersPerDegreeLng,

    anchorLat +
      y /
        metersPerDegreeLat,
  ];
}

/**
 * Normalize a DB building.
 *
 * Handles:
 * - floors as array
 * - floors as JSON string
 * - units as array
 * - units as JSON string
 * - polygon as JSON string
 * - latitude / longitude at different nesting levels
 */
function normalizeBuilding(
  input: any
): ParsedBuilding | null {
  if (!input) {
    return null;
  }

  const latitude = Number(
    input?.georeference
      ?.latitude ??
      input?.latitude ??
      input?.lat
  );

  const longitude = Number(
    input?.georeference
      ?.longitude ??
      input?.longitude ??
      input?.lng
  );

  const hasCoordinates =
    Number.isFinite(
      latitude
    ) &&
    Number.isFinite(
      longitude
    ) &&
    Math.abs(latitude) <=
      90 &&
    Math.abs(longitude) <=
      180;

  let floors =
    parseMaybeJSON<any[]>(
      input?.floors,
      []
    );

  if (
    !Array.isArray(
      floors
    )
  ) {
    floors = [];
  }

  /**
   * Some records may store a direct `units`
   * collection rather than nested floors.
   */
  if (
    floors.length === 0 &&
    input?.units
  ) {
    const directUnits =
      parseMaybeJSON<any[]>(
        input.units,
        []
      );

    if (
      Array.isArray(
        directUnits
      ) &&
      directUnits.length
    ) {
      floors = [
        {
          floorNumber: 0,
          elevation: 0,
          height: 3.2,
          units: directUnits,
        },
      ];
    }
  }

  /**
   * Some database serializers wrap the data.
   */
  if (
    floors.length === 0 &&
    input?.data
  ) {
    const data =
      parseMaybeJSON<any>(
        input.data,
        null
      );

    if (
      data?.floors
    ) {
      floors =
        parseMaybeJSON<any[]>(
          data.floors,
          []
        );
    }
  }

  return {
    id: String(
      input?.id ??
        `BUILDING-${Date.now()}-${Math.random()}`
    ),

    name:
      input?.name ??
      input?.buildingName ??
      input?.title ??
      "Cadastral Building",

    address:
      input?.address ??
      input?.location ??
      "",

    ...(hasCoordinates
      ? {
          georeference: {
            latitude,
            longitude,
          },
        }
      : {}),

    floors: floors.map(
      (
        floor: any,
        floorIndex: number
      ) => {
        const parsedUnits =
          parseMaybeJSON<any[]>(
            floor?.units,
            []
          );

        const units =
          Array.isArray(
            parsedUnits
          )
            ? parsedUnits
            : [];

        return {
          floorNumber:
            Number(
              floor?.floorNumber ??
                floor?.level ??
                floorIndex
            ) || 0,

          elevation:
            Number(
              floor?.elevation ??
                floor?.elevationMeters ??
                floorIndex * 3.2
            ) || 0,

          height:
            Number(
              floor?.height ??
                floor?.heightMeters ??
                3.2
            ) || 3.2,

          units: units.map(
            (
              unit: any,
              unitIndex: number
            ) => {
              let polygon =
                parseMaybeJSON<
                  any[]
                >(
                  unit?.polygon ??
                    unit?.geometry
                      ?.coordinates?.[0],
                  []
                );

              /**
               * Normalize GeoJSON geometry.
               */
              if (
                unit?.geometry
                  ?.type ===
                  "Polygon"
              ) {
                polygon =
                  unit
                    .geometry
                    .coordinates?.[0] ??
                  polygon;
              }

              return {
                id: String(
                  unit?.id ??
                    `UNIT-${floorIndex}-${unitIndex}`
                ),

                unitNumber: String(
                  unit?.unitNumber ??
                    unit?.unit ??
                    unit?.name ??
                    unit?.id ??
                    `UNIT-${unitIndex + 1}`
                ),

                floorNumber:
                  Number(
                    floor?.floorNumber ??
                      floor?.level ??
                      floorIndex
                  ) || 0,

                area:
                  Number(
                    unit?.area ??
                      unit?.areaSqm ??
                      unit?.areaMeters
                  ) || 0,

                polygon:
                  Array.isArray(
                    polygon
                  )
                    ? polygon
                    : [],

                ulpin:
                  unit?.ulpin ??
                  unit?.ULPIN ??
                  undefined,

                spaceType:
                  unit?.spaceType ??
                  unit?.category ??
                  "RESIDENTIAL",
              };
            }
          ),
        };
      }
    ),
  };
}

/* ============================================================
   MAIN COMPONENT
   ============================================================ */

export default function RealWorldMapViewer({
  building,
  buildings = [],
  approvalStatus,
  onPropertySelect,
  onPropertyNavigate,
  onBuildingSelect,
}: RealWorldMapViewerProps) {
  const containerRef =
    useRef<HTMLDivElement | null>(
      null
    );

  const mapRef =
    useRef<Map | null>(
      null
    );

  const markerRefs =
    useRef<Marker[]>([]);

  const [mapReady, setMapReady] =
    useState(false);

  const [is3D, setIs3D] =
    useState(true);

  const [rotating, setRotating] =
    useState(false);

  /**
   * Normalize incoming records.
   */
  const normalizedBuildings =
    useMemo(() => {
      const input =
        buildings.length > 0
          ? buildings
          : building
            ? [building]
            : [];

      return input
        .map(
          normalizeBuilding
        )
        .filter(
          (
            item
          ): item is ParsedBuilding =>
            item !== null
        );
    }, [
      buildings,
      building,
    ]);

  /**
   * Buildings with coordinates.
   */
  const mapBuildings =
    useMemo(() => {
      return normalizedBuildings.filter(
        (item) =>
          item.georeference &&
          Number.isFinite(
            item.georeference
              .latitude
          ) &&
          Number.isFinite(
            item.georeference
              .longitude
          )
      );
    }, [
      normalizedBuildings,
    ]);

  const multiBuildingMode =
    buildings.length > 0;

  /**
   * ----------------------------------------------------------
   * CREATE GEOJSON
   * ----------------------------------------------------------
   */
  const createGeoJSON =
    () => {
      const features: any[] =
        [];

      for (const currentBuilding of mapBuildings) {
        const anchor =
          currentBuilding.georeference!;

        for (const floor of
          currentBuilding.floors ??
          []) {
          for (const unit of
            floor.units ??
            []) {
            let rawPolygon =
              Array.isArray(
                unit.polygon
              )
                ? unit.polygon
                : [];

            /**
             * No valid polygon?
             * Do not fabricate the unit in GeoJSON.
             *
             * A structure marker will still be
             * displayed for the building.
             */
            if (
              rawPolygon.length <
              3
            ) {
              continue;
            }

            const geographic =
              isProbablyGeographic(
                rawPolygon as PointLike[],
                anchor.longitude,
                anchor.latitude
              );

            const geoPolygon =
              rawPolygon.map(
                (point) => {
                  const [
                    x,
                    y,
                  ] =
                    getXY(
                      point as PointLike
                    );

                  return geographic
                    ? [x, y]
                    : localToLngLat(
                        x,
                        y,
                        anchor.longitude,
                        anchor.latitude
                      );
                }
              );

            /**
             * Close ring.
             */
            const first =
              geoPolygon[0];

            const last =
              geoPolygon[
                geoPolygon.length -
                  1
              ];

            if (
              first &&
              last &&
              (first[0] !==
                last[0] ||
                first[1] !==
                  last[1])
            ) {
              geoPolygon.push([
                first[0],
                first[1],
              ]);
            }

            if (
              geoPolygon.length <
              4
            ) {
              continue;
            }

            const space =
              `${unit.spaceType ?? ""} ${unit.unitNumber ?? ""}`.toLowerCase();

            let fillColor =
              "#2563eb";

            if (
              space.includes(
                "stair"
              ) ||
              space.includes(
                "staircase"
              )
            ) {
              fillColor =
                "#f97316";
            } else if (
              space.includes(
                "lift"
              ) ||
              space.includes(
                "elevator"
              )
            ) {
              fillColor =
                "#8b5cf6";
            } else if (
              space.includes(
                "corridor"
              ) ||
              space.includes(
                "passage"
              )
            ) {
              fillColor =
                "#64748b";
            } else if (
              space.includes(
                "toilet"
              ) ||
              space.includes(
                "restroom"
              )
            ) {
              fillColor =
                "#ec4899";
            }

            const base =
              Number(
                floor.elevation
              ) || 0;

            const height =
              base +
              (Number(
                floor.height
              ) || 3.2);

            features.push({
              type:
                "Feature",

              id:
                `${currentBuilding.id}-${unit.id}`,

              properties: {
                buildingId:
                  currentBuilding.id,

                buildingName:
                  currentBuilding.name ??
                  "Cadastral Building",

                unitId:
                  unit.id,

                unitNumber:
                  unit.unitNumber,

                floorNumber:
                  floor.floorNumber,

                area:
                  unit.area,

                ulpin:
                  unit.ulpin ??
                  "",

                spaceType:
                  unit.spaceType ??
                  "RESIDENTIAL",

                base,

                height,

                fillColor,
              },

              geometry: {
                type:
                  "Polygon",

                coordinates: [
                  geoPolygon,
                ],
              },
            });
          }
        }
      }

      return {
        type:
          "FeatureCollection" as const,

        features,
      };
    };

  /**
   * ----------------------------------------------------------
   * FIT ALL BUILDINGS
   * ----------------------------------------------------------
   */
  const fitAllBuildings =
    () => {
      const map =
        mapRef.current;

      if (
        !map ||
        mapBuildings.length ===
          0
      ) {
        return;
      }

      const bounds =
        new LngLatBounds();

      for (const item of mapBuildings) {
        const anchor =
          item.georeference!;

        /**
         * Always include GNSS anchor.
         */
        bounds.extend([
          anchor.longitude,
          anchor.latitude,
        ]);

        /**
         * Include actual polygon geometry
         * when available.
         */
        for (const floor of
          item.floors ??
          []) {
          for (const unit of
            floor.units ??
            []) {
            const polygon =
              Array.isArray(
                unit.polygon
              )
                ? unit.polygon
                : [];

            if (
              polygon.length <
              3
            ) {
              continue;
            }

            const geographic =
              isProbablyGeographic(
                polygon as PointLike[],
                anchor.longitude,
                anchor.latitude
              );

            for (const point of polygon) {
              const [
                x,
                y,
              ] =
                getXY(
                  point as PointLike
                );

              const coordinate =
                geographic
                  ? [x, y]
                  : localToLngLat(
                      x,
                      y,
                      anchor.longitude,
                      anchor.latitude
                    );

              bounds.extend(
                coordinate as [
                  number,
                  number
                ]
              );
            }
          }
        }
      }

      if (
        !bounds.isEmpty()
      ) {
        map.fitBounds(
          bounds,
          {
            padding:
              multiBuildingMode
                ? {
                    top: 120,
                    right: 180,
                    bottom: 160,
                    left: 180,
                  }
                : {
                    top: 120,
                    right: 220,
                    bottom: 180,
                    left: 220,
                  },

            maxZoom:
              multiBuildingMode
                ? 16
                : 18,

            pitch:
              is3D
                ? multiBuildingMode
                  ? 45
                  : 55
                : 0,

            duration:
              700,
          }
        );
      }
    };

  /**
   * ----------------------------------------------------------
   * INITIALIZE MAP
   * ----------------------------------------------------------
   *
   * IMPORTANT:
   * We do NOT block map creation when there is
   * no building geometry. A valid coordinate alone
   * is enough to create a visible structure marker.
   */
  useEffect(() => {
    if (
      !containerRef.current
    ) {
      return;
    }

    if (
      mapBuildings.length ===
      0
    ) {
      return;
    }

    if (
      mapRef.current
    ) {
      return;
    }

    const first =
      mapBuildings[0];

    const anchor =
      first.georeference!;

    const map = new Map({
      container:
        containerRef.current,

      style:
        "https://tiles.openfreemap.org/styles/bright",

      center: [
        anchor.longitude,
        anchor.latitude,
      ],

      zoom:
        multiBuildingMode
          ? 13
          : 16,

      minZoom: 3,

      maxZoom: 22,

      pitch:
        multiBuildingMode
          ? 42
          : 55,

      bearing: 0,

      antialias: true,

      attributionControl:
        true,
    });

    mapRef.current =
      map;

    map.addControl(
      new NavigationControl({
        showCompass: true,
        showZoom: false,
        visualizePitch:
          true,
      }),
      "top-right"
    );

    map.addControl(
      new ScaleControl({
        maxWidth: 140,
        unit: "metric",
      }),
      "bottom-left"
    );

    map.on(
      "load",
      () => {
        setMapReady(true);

        window.setTimeout(
          () => {
            map.resize();
          },
          200
        );
      }
    );

    return () => {
      markerRefs.current.forEach(
        (marker) =>
          marker.remove()
      );

      markerRefs.current =
        [];

      map.remove();

      mapRef.current =
        null;

      setMapReady(false);
    };
  }, [
    mapBuildings.length,
    mapBuildings[0]?.id,
    mapBuildings[0]
      ?.georeference
      ?.latitude,
    mapBuildings[0]
      ?.georeference
      ?.longitude,
    multiBuildingMode,
  ]);

  /**
   * ----------------------------------------------------------
   * ADD BUILDING MARKERS
   * ----------------------------------------------------------
   *
   * This is the critical fallback.
   *
   * Every building with valid GNSS coordinates gets a
   * structure marker even when floor geometry isn't returned.
   */
  useEffect(() => {
    const map =
      mapRef.current;

    if (
      !map ||
      !mapReady
    ) {
      return;
    }

    /**
     * Remove old markers.
     */
    markerRefs.current.forEach(
      (marker) =>
        marker.remove()
    );

    markerRefs.current =
      [];

    for (const currentBuilding of mapBuildings) {
      const anchor =
        currentBuilding.georeference;

      if (!anchor) {
        continue;
      }

      /**
       * Structure-style marker.
       */
      const element =
        document.createElement(
          "button"
        );

      element.type =
        "button";

      element.setAttribute(
        "aria-label",
        `Open ${currentBuilding.name ?? "building"}`
      );

      element.style.width =
        multiBuildingMode
          ? "42px"
          : "34px";

      element.style.height =
        multiBuildingMode
          ? "42px"
          : "34px";

      element.style.padding =
        "0";

      element.style.border =
        "2px solid #ffffff";

      element.style.borderRadius =
        "9px";

      element.style.background =
        "linear-gradient(135deg,#2563eb,#1d4ed8)";

      element.style.boxShadow =
        "0 5px 18px rgba(37,99,235,0.55)";

      element.style.cursor =
        "pointer";

      element.style.display =
        "flex";

      element.style.alignItems =
        "center";

      element.style.justifyContent =
        "center";

      element.style.color =
        "#ffffff";

      element.style.fontSize =
        multiBuildingMode
          ? "19px"
          : "15px";

      element.style.fontWeight =
        "800";

      element.style.lineHeight =
        "1";

      element.innerHTML =
        "▦";

      element.addEventListener(
        "mouseenter",
        () => {
          element.style.transform =
            "scale(1.12)";
        }
      );

      element.addEventListener(
        "mouseleave",
        () => {
          element.style.transform =
            "scale(1)";
        }
      );

      element.addEventListener(
        "click",
        () => {
          if (
            multiBuildingMode
          ) {
            onBuildingSelect?.(
              currentBuilding
            );

            /**
             * Focus on selected building.
             */
            const bounds =
              getSingleBuildingBounds(
                currentBuilding
              );

            if (
              bounds
            ) {
              map.fitBounds(
                bounds,
                {
                  padding: {
                    top: 170,
                    right: 240,
                    bottom: 220,
                    left: 240,
                  },

                  maxZoom:
                    18,

                  pitch:
                    55,

                  duration:
                    800,
                }
              );
            }

            return;
          }
        }
      );

      const marker =
        new Marker({
          element,
          anchor:
            "center",
        })
          .setLngLat([
            anchor.longitude,
            anchor.latitude,
          ])
          .addTo(map);

      /**
       * Popup for building marker.
       */
      const popup =
        new Popup({
          offset: 24,
          closeButton:
            true,
          closeOnClick:
            false,
          maxWidth:
            "300px",
        }).setHTML(
          `
            <div
              style="
                font-family:system-ui,sans-serif;
                color:#0f172a;
                padding:5px;
              "
            >
              <div
                style="
                  font-size:15px;
                  font-weight:800;
                  margin-bottom:6px;
                "
              >
                ${
                  currentBuilding.name ??
                  "Cadastral Building"
                }
              </div>

              <div
                style="
                  font-size:11px;
                  color:#64748b;
                  line-height:1.7;
                "
              >
                <div>
                  📍 ${
                    anchor.latitude.toFixed(
                      6
                    )
                  }, ${
                    anchor.longitude.toFixed(
                      6
                    )
                  }
                </div>

                <div>
                  Floors: ${
                    currentBuilding.floors
                      ?.length ??
                    0
                  }
                </div>
              </div>

              ${
                multiBuildingMode
                  ? `
                    <div
                      style="
                        margin-top:8px;
                        color:#2563eb;
                        font-size:11px;
                        font-weight:800;
                      "
                    >
                      Click structure to explore →
                    </div>
                  `
                  : ""
              }
            </div>
          `
        );

      marker.setPopup(
        popup
      );

      markerRefs.current.push(
        marker
      );
    }
  }, [
    mapReady,
    mapBuildings,
    multiBuildingMode,
    onBuildingSelect,
  ]);

  /**
   * ----------------------------------------------------------
   * SINGLE BUILDING BOUNDS
   * ----------------------------------------------------------
   */
  function getSingleBuildingBounds(
    target: ParsedBuilding
  ) {
    if (
      !target.georeference
    ) {
      return null;
    }

    const anchor =
      target.georeference;

    const bounds =
      new LngLatBounds();

    bounds.extend([
      anchor.longitude,
      anchor.latitude,
    ]);

    for (const floor of
      target.floors ??
      []) {
      for (const unit of
        floor.units ??
        []) {
        const polygon =
          Array.isArray(
            unit.polygon
          )
            ? unit.polygon
            : [];

        if (
          polygon.length <
          3
        ) {
          continue;
        }

        const geographic =
          isProbablyGeographic(
            polygon as PointLike[],
            anchor.longitude,
            anchor.latitude
          );

        for (const point of polygon) {
          const [
            x,
            y,
          ] =
            getXY(
              point as PointLike
            );

          const coordinate =
            geographic
              ? [x, y]
              : localToLngLat(
                  x,
                  y,
                  anchor.longitude,
                  anchor.latitude
                );

          bounds.extend(
            coordinate as [
              number,
              number
            ]
          );
        }
      }
    }

    return bounds;
  }

  /**
   * ----------------------------------------------------------
   * CADASTRAL POLYGON LAYERS
   * ----------------------------------------------------------
   */
  useEffect(() => {
    const map =
      mapRef.current;

    if (
      !map ||
      !mapReady
    ) {
      return;
    }

    /**
     * Safety cleanup.
     */
    if (
      map.getLayer(
        OUTLINE_LAYER
      )
    ) {
      map.removeLayer(
        OUTLINE_LAYER
      );
    }

    if (
      map.getLayer(
        EXTRUSION_LAYER
      )
    ) {
      map.removeLayer(
        EXTRUSION_LAYER
      );
    }

    if (
      map.getLayer(
        FOOTPRINT_LAYER
      )
    ) {
      map.removeLayer(
        FOOTPRINT_LAYER
      );
    }

    if (
      map.getSource(
        SOURCE_ID
      )
    ) {
      map.removeSource(
        SOURCE_ID
      );
    }

    const geojson =
      createGeoJSON();

    /**
     * It is perfectly valid for this to be empty
     * when the DB has anchor coordinates but no
     * usable unit geometry.
     */
    map.addSource(
      SOURCE_ID,
      {
        type:
          "geojson",

        data:
          geojson,
      }
    );

    map.addLayer({
      id:
        FOOTPRINT_LAYER,

      type:
        "fill",

      source:
        SOURCE_ID,

      paint: {
        "fill-color":
          [
            "get",
            "fillColor",
          ],

        "fill-opacity":
          multiBuildingMode
            ? 0.78
            : 0.32,
      },
    });

    map.addLayer({
      id:
        EXTRUSION_LAYER,

      type:
        "fill-extrusion",

      source:
        SOURCE_ID,

      paint: {
        "fill-extrusion-color":
          [
            "get",
            "fillColor",
          ],

        "fill-extrusion-base":
          [
            "to-number",
            [
              "get",
              "base",
            ],
            0,
          ],

        "fill-extrusion-height":
          [
            "to-number",
            [
              "get",
              "height",
            ],
            3,
          ],

        "fill-extrusion-opacity":
          multiBuildingMode
            ? 0.9
            : 0.88,

        "fill-extrusion-vertical-gradient":
          true,
      },
    });

    map.addLayer({
      id:
        OUTLINE_LAYER,

      type:
        "line",

      source:
        SOURCE_ID,

      paint: {
        "line-color":
          "#0f172a",

        "line-width":
          2.1,

        "line-opacity":
          0.95,
      },
    });

    /**
     * --------------------------------------------------------
     * POLYGON CLICK
     * --------------------------------------------------------
     */
    const handlePolygonClick =
      (event: any) => {
        const features =
          map.queryRenderedFeatures(
            event.point,
            {
              layers: [
                EXTRUSION_LAYER,
                FOOTPRINT_LAYER,
              ],
            }
          );

        if (
          !features.length
        ) {
          return;
        }

        const properties =
          features[0]
            ?.properties;

        if (
          !properties
        ) {
          return;
        }

        if (
          multiBuildingMode
        ) {
          const selected =
            mapBuildings.find(
              (item) =>
                String(
                  item.id
                ) ===
                String(
                  properties.buildingId
                )
            );

          if (
            selected
          ) {
            onBuildingSelect?.(
              selected
            );
          }

          return;
        }

        const target =
          normalizedBuildings[0];

        if (!target) {
          return;
        }

        const unitId =
          String(
            properties.unitId ??
              ""
          );

        const unit =
          target.floors
            ?.flatMap(
              (floor) =>
                floor.units ??
                []
            )
            .find(
              (item) =>
                String(
                  item.id
                ) ===
                unitId
            );

        if (!unit) {
          return;
        }

        onPropertySelect?.(
          unit
        );

        onPropertyNavigate?.(
          unit
        );

        new Popup({
          closeButton:
            true,
          closeOnClick:
            true,
          maxWidth:
            "320px",
        })
          .setLngLat(
            event.lngLat
          )
          .setHTML(
            `
              <div
                style="
                  font-family:system-ui,sans-serif;
                  color:#0f172a;
                  padding:6px;
                "
              >
                <div
                  style="
                    font-size:16px;
                    font-weight:800;
                  "
                >
                  Unit ${
                    unit.unitNumber ||
                    "—"
                  }
                </div>

                <div
                  style="
                    margin-top:6px;
                    font-size:12px;
                    line-height:1.7;
                    color:#64748b;
                  "
                >
                  <div>
                    Floor:
                    ${
                      unit.floorNumber
                    }
                  </div>

                  <div>
                    Area:
                    ${
                      unit.area ||
                      "—"
                    } m²
                  </div>

                  <div>
                    ULPIN:
                    ${
                      unit.ulpin ||
                      "Not assigned"
                    }
                  </div>
                </div>
              </div>
            `
          )
          .addTo(map);
      };

    map.on(
      "click",
      EXTRUSION_LAYER,
      handlePolygonClick
    );

    map.on(
      "click",
      FOOTPRINT_LAYER,
      handlePolygonClick
    );

    /**
     * Initial fit.
     */
    fitAllBuildings();

    return () => {
      map.off(
        "click",
        EXTRUSION_LAYER,
        handlePolygonClick
      );

      map.off(
        "click",
        FOOTPRINT_LAYER,
        handlePolygonClick
      );

      if (
        map.getLayer(
          OUTLINE_LAYER
        )
      ) {
        map.removeLayer(
          OUTLINE_LAYER
        );
      }

      if (
        map.getLayer(
          EXTRUSION_LAYER
        )
      ) {
        map.removeLayer(
          EXTRUSION_LAYER
        );
      }

      if (
        map.getLayer(
          FOOTPRINT_LAYER
        )
      ) {
        map.removeLayer(
          FOOTPRINT_LAYER
        );
      }

      if (
        map.getSource(
          SOURCE_ID
        )
      ) {
        map.removeSource(
          SOURCE_ID
        );
      }
    };
  }, [
    mapReady,
    mapBuildings,
    normalizedBuildings,
    multiBuildingMode,
    onBuildingSelect,
    onPropertySelect,
    onPropertyNavigate,
  ]);

  /**
   * ----------------------------------------------------------
   * BUTTONS
   * ----------------------------------------------------------
   */

  const zoomIn =
    () => {
      mapRef.current?.zoomIn({
        duration: 300,
      });
    };

  const zoomOut =
    () => {
      mapRef.current?.zoomOut({
        duration: 300,
      });
    };

  const toggle3D =
    () => {
      const map =
        mapRef.current;

      if (!map) {
        return;
      }

      setIs3D(
        (previous) => {
          const next =
            !previous;

          map.easeTo({
            pitch:
              next
                ? multiBuildingMode
                  ? 45
                  : 55
                : 0,

            duration:
              650,
          });

          return next;
        }
      );
    };

  /**
   * ----------------------------------------------------------
   * ROTATION
   * ----------------------------------------------------------
   */
  useEffect(() => {
    const map =
      mapRef.current;

    if (
      !map ||
      !rotating
    ) {
      return;
    }

    let frame =
      0;

    const rotate =
      () => {
        map.setBearing(
          map.getBearing() +
            0.15
        );

        frame =
          requestAnimationFrame(
            rotate
          );
      };

    frame =
      requestAnimationFrame(
        rotate
      );

    return () => {
      cancelAnimationFrame(
        frame
      );
    };
  }, [
    rotating,
  ]);

  /**
   * ----------------------------------------------------------
   * EMPTY STATE
   * ----------------------------------------------------------
   *
   * This is now much more informative.
   */
  if (
    mapBuildings.length ===
    0
  ) {
    return (
      <div
        style={{
          width:
            "100%",

          height:
            "100%",

          minHeight:
            "650px",

          borderRadius:
            "18px",

          background:
            "#e2e8f0",

          display:
            "flex",

          alignItems:
            "center",

          justifyContent:
            "center",
        }}
      >
        <div
          style={{
            textAlign:
              "center",

            padding:
              "30px",

            maxWidth:
              "560px",

            background:
              "#ffffff",

            borderRadius:
              "16px",

            boxShadow:
              "0 10px 35px rgba(0,0,0,0.10)",
          }}
        >
          <div
            style={{
              fontSize:
                "18px",

              fontWeight:
                800,

              color:
                "#0f172a",
            }}
          >
            No map coordinates found
          </div>

          <div
            style={{
              marginTop:
                "8px",

              fontSize:
                "13px",

              lineHeight:
                1.6,

              color:
                "#64748b",
            }}
          >
            Database records received:
            {" "}
            {
              normalizedBuildings.length
            }
            .
            <br />
            None contain a valid
            latitude/longitude pair.
          </div>
        </div>
      </div>
    );
  }

  /**
   * ----------------------------------------------------------
   * MAP UI
   * ----------------------------------------------------------
   */
  return (
    <div
      style={{
        position:
          "relative",

        width:
          "100%",

        height:
          "100%",

        minHeight:
          "650px",

        borderRadius:
          "18px",

        overflow:
          "hidden",

        background:
          "#dbeafe",
      }}
    >
      {/* MAP */}

      <div
        ref={
          containerRef
        }
        style={{
          position:
            "absolute",

          inset:
            0,
        }}
      />

      {/* ---------------------------------------------------- */}
      {/* INFO PANEL */}
      {/* ---------------------------------------------------- */}

      <div
        style={{
          position:
            "absolute",

          top:
            "18px",

          left:
            "18px",

          zIndex:
            20,

          background:
            "rgba(255,255,255,0.96)",

          borderRadius:
            "13px",

          padding:
            "12px 15px",

          boxShadow:
            "0 7px 22px rgba(0,0,0,0.14)",

          pointerEvents:
            "none",
        }}
      >
        <div
          style={{
            fontSize:
              "16px",

            fontWeight:
              800,

            color:
              "#111827",
          }}
        >
          {multiBuildingMode
            ? "Public Cadastral Map"
            : building?.name ??
              "Cadastral Building"}
        </div>

        <div
          style={{
            marginTop:
              "4px",

            fontSize:
              "11px",

            color:
              "#64748b",
          }}
        >
          {multiBuildingMode
            ? `${mapBuildings.length} structures visible`
            : approvalStatus ??
              "Cadastral structure"}
        </div>

        {multiBuildingMode && (
          <div
            style={{
              marginTop:
                "5px",

              fontSize:
                "11px",

              color:
                "#2563eb",

              fontWeight:
                700,
            }}
          >
            Click a structure to explore
          </div>
        )}
      </div>

      {/* ---------------------------------------------------- */}
      {/* CONTROLS */}
      {/* ---------------------------------------------------- */}

      <div
        style={{
          position:
            "absolute",

          right:
            "18px",

          bottom:
            "120px",

          zIndex:
            30,

          display:
            "flex",

          flexDirection:
            "column",

          gap:
            "8px",
        }}
      >
        <button
          type="button"
          onClick={
            zoomIn
          }
          title="Zoom in"
          style={controlStyle}
        >
          +
        </button>

        <button
          type="button"
          onClick={
            zoomOut
          }
          title="Zoom out"
          style={controlStyle}
        >
          −
        </button>

        <button
          type="button"
          onClick={
            toggle3D
          }
          title="Toggle 2D / 3D"
          style={{
            ...controlStyle,

            background:
              is3D
                ? "#111827"
                : "#ffffff",

            color:
              is3D
                ? "#ffffff"
                : "#111827",

            fontSize:
              "12px",
          }}
        >
          3D
        </button>

        <button
          type="button"
          onClick={() =>
            setRotating(
              (value) =>
                !value
            )
          }
          title={
            rotating
              ? "Stop rotation"
              : "Rotate map"
          }
          style={{
            ...controlStyle,

            background:
              rotating
                ? "#2563eb"
                : "#ffffff",

            color:
              rotating
                ? "#ffffff"
                : "#111827",

            fontSize:
              "20px",
          }}
        >
          ↻
        </button>

        <button
          type="button"
          onClick={
            fitAllBuildings
          }
          title="Show all structures"
          style={{
            ...controlStyle,

            fontSize:
              "18px",
          }}
        >
          ⌂
        </button>
      </div>

      {/* ---------------------------------------------------- */}
      {/* LEGEND */}
      {/* ---------------------------------------------------- */}

      <div
        style={{
          position:
            "absolute",

          left:
            "18px",

          bottom:
            "18px",

          zIndex:
            20,

          display:
            "flex",

          alignItems:
            "center",

          flexWrap:
            "wrap",

          gap:
            "10px",

          padding:
            "10px 13px",

          background:
            "rgba(255,255,255,0.96)",

          borderRadius:
            "11px",

          boxShadow:
            "0 5px 18px rgba(0,0,0,0.12)",

          fontSize:
            "11px",

          color:
            "#374151",
        }}
      >
        <LegendDot color="#2563eb" />

        {multiBuildingMode
          ? "Structures"
          : "Units"}

        <LegendDot color="#f97316" />

        Stairs

        <LegendDot color="#8b5cf6" />

        Lift
      </div>
    </div>
  );
}

/* ============================================================
   UI HELPERS
   ============================================================ */

const controlStyle: React.CSSProperties =
  {
    width:
      "46px",

    height:
      "46px",

    flexShrink:
      0,

    border:
      "none",

    borderRadius:
      "11px",

    background:
      "#ffffff",

    color:
      "#111827",

    boxShadow:
      "0 5px 16px rgba(0,0,0,0.16)",

    fontSize:
      "25px",

    fontWeight:
      700,

    cursor:
      "pointer",

    display:
      "flex",

    alignItems:
      "center",

    justifyContent:
      "center",
  };

function LegendDot({
  color,
}: {
  color: string;
}) {
  return (
    <span
      style={{
        width:
          "12px",

        height:
          "12px",

        borderRadius:
          "3px",

        background:
          color,

        display:
          "inline-block",
      }}
    />
  );
}

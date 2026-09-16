
"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";

import FileUploader from "@/src/components/FileUploader";
import type {
  ParsedBuilding,
  Property2D,
} from "@/src/lib/parser/types";

import VolumetricViewer from "@/src/components/VolumetricViewer";
import CadastralGraph from "@/src/components/CadastralGraph";
import ULPINSearch from "@/src/components/ULPINSearch";
import ExportPanel from "@/src/components/ExportPanel";
import TopologyValidator from "@/src/components/TopologyValidator";
import SurveyorApprovalPanel, {
  SurveyorVerificationData,
} from "@/src/components/SurveyorApprovalPanel";

// Database Server Actions
import {
  getAllBuildings,
  approveBuilding,
  savePendingBuilding,
  updateBuildingStatus,
  deleteBuilding,
} from "@/src/app/actions/cadastre";

/**
 * MapLibre must remain client-side.
 */
const RealWorldMapViewer = dynamic(
  () =>
    import(
      "@/src/components/RealWorldMapViewer"
    ),
  {
    ssr: false,
  }
);

type RoleMode =
  | "PUBLIC_VIEWER"
  | "SURVEYOR"
  | "UPLOADER";

export default function Dashboard() {
  const router = useRouter();

  const [roleMode, setRoleMode] =
    useState<RoleMode>("PUBLIC_VIEWER");

  const [showUploader, setShowUploader] =
    useState(false);

  /**
   * All buildings loaded from PostgreSQL.
   *
   * Public Viewer:
   * all buildings are displayed on the map.
   *
   * Surveyor:
   * all submissions are displayed in the
   * management panel.
   */
  const [buildingList, setBuildingList] =
    useState<any[]>([]);

  /**
   * Currently selected building.
   *
   * Public Viewer starts with null so the
   * initial screen is the all-buildings map.
   */
  const [building, setBuilding] =
    useState<ParsedBuilding | null>(
      null
    );

  const [selectedProperty, setSelectedProperty] =
    useState<string | null>(null);

  const [verification, setVerification] =
    useState<SurveyorVerificationData | null>(
      null
    );

  const [loadingDb, setLoadingDb] =
    useState(false);

  /**
   * ============================================================
   * DATABASE BUILDING -> ParsedBuilding
   * ============================================================
   */
  const mapDbToParsedBuilding = (
    dbBuilding: any
  ): ParsedBuilding => {
    const latitude = Number(
      dbBuilding?.latitude ??
        dbBuilding?.georeference?.latitude
    );

    const longitude = Number(
      dbBuilding?.longitude ??
        dbBuilding?.georeference?.longitude
    );

    const hasValidGeoreference =
      Number.isFinite(latitude) &&
      Number.isFinite(longitude) &&
      Math.abs(latitude) <= 90 &&
      Math.abs(longitude) <= 180;

    const floors = Array.isArray(
      dbBuilding?.floors
    )
      ? dbBuilding.floors
      : [];

    return {
      id:
        dbBuilding?.id ??
        `BLDG-${Date.now()}-${Math.random()}`,

      name:
        dbBuilding?.name ??
        dbBuilding?.buildingName ??
        "Cadastral Building",

      address:
        dbBuilding?.address ??
        "",

      ...(hasValidGeoreference
        ? {
            georeference: {
              latitude,
              longitude,
            },
          }
        : {}),

      floors: floors.map(
        (floor: any) => ({
          floorNumber:
            Number(
              floor?.floorNumber
            ) || 0,

          elevation:
            Number(
              floor?.elevation
            ) || 0,

          height:
            Number(
              floor?.height
            ) || 3,

          units: Array.isArray(
            floor?.units
          )
            ? floor.units.map(
                (unit: any) => {
                  let polygon =
                    unit?.polygon;

                  /**
                   * PostgreSQL may return
                   * polygon as JSON text.
                   */
                  if (
                    typeof polygon ===
                    "string"
                  ) {
                    try {
                      polygon =
                        JSON.parse(
                          polygon
                        );
                    } catch {
                      polygon = [];
                    }
                  }

                  return {
                    id:
                      unit?.id ??
                      `UNIT-${Date.now()}-${Math.random()}`,

                    unitNumber:
                      unit?.unitNumber ??
                      unit?.id ??
                      "UNIT",

                    floorNumber:
                      Number(
                        floor?.floorNumber
                      ) || 0,

                    area:
                      Number(
                        unit?.area
                      ) || 0,

                    polygon:
                      Array.isArray(
                        polygon
                      )
                        ? polygon
                        : [],

                    ulpin:
                      unit?.ulpin ||
                      undefined,

                    spaceType:
                      unit?.spaceType ??
                      "RESIDENTIAL",
                  };
                }
              )
            : [],
        })
      ),
    };
  };

  /**
   * ============================================================
   * GET BUILDING STATISTICS
   * ============================================================
   */
  const getBuildingStats = (
    dbBuilding: any
  ) => {
    const floors =
      Array.isArray(
        dbBuilding?.floors
      )
        ? dbBuilding.floors
        : [];

    let units = 0;

    for (const floor of floors) {
      if (
        Array.isArray(
          floor?.units
        )
      ) {
        units +=
          floor.units.length;
      }
    }

    return {
      floors: floors.length,
      units,
    };
  };

  /**
   * ============================================================
   * BUILDINGS THAT CAN ACTUALLY BE PUT ON MAP
   * ============================================================
   *
   * We keep every DB record in buildingList, but only pass
   * buildings with valid GNSS coordinates to the geographic
   * map.
   */
  const publicMapBuildings =
    useMemo(() => {
      return buildingList
        .map(
          mapDbToParsedBuilding
        )
        .filter(
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
    }, [buildingList]);

  /**
   * ============================================================
   * LOAD DATABASE RECORDS
   * ============================================================
   */
  const loadDatabaseRecords =
    async () => {
      setLoadingDb(true);

      try {
        /**
         * ------------------------------------------------------
         * PUBLIC VIEWER
         * ------------------------------------------------------
         *
         * IMPORTANT:
         * We intentionally use getAllBuildings().
         *
         * This means buildings do not have to be APPROVED
         * just to appear as structures on the public map.
         *
         * No first record is automatically selected.
         */
        if (
          roleMode ===
          "PUBLIC_VIEWER"
        ) {
          const res =
            await getAllBuildings();

          if (
            res.success &&
            res.data
          ) {
            setBuildingList(
              res.data
            );

            /**
             * Return public viewer to
             * map-first state.
             */
            setBuilding(null);

            setSelectedProperty(
              null
            );

            setVerification(null);
          } else {
            setBuildingList([]);
            setBuilding(null);
            setSelectedProperty(
              null
            );
          }

          return;
        }

        /**
         * ------------------------------------------------------
         * SURVEYOR
         * ------------------------------------------------------
         */
        if (
          roleMode ===
          "SURVEYOR"
        ) {
          const res =
            await getAllBuildings();

          if (
            res.success &&
            res.data
          ) {
            setBuildingList(
              res.data
            );

            /**
             * Surveyor continues to open the
             * first record for inspection.
             */
            if (
              res.data.length >
              0
            ) {
              setBuilding(
                (current) => {
                  if (current) {
                    return current;
                  }

                  return mapDbToParsedBuilding(
                    res.data[0]
                  );
                }
              );
            } else {
              setBuilding(null);
            }
          } else {
            setBuildingList([]);
            setBuilding(null);
          }

          return;
        }

        /**
         * ------------------------------------------------------
         * UPLOADER
         * ------------------------------------------------------
         */
        if (
          roleMode ===
          "UPLOADER"
        ) {
          return;
        }
      } catch (error) {
        console.error(
          "Failed to load cadastral records:",
          error
        );
      } finally {
        setLoadingDb(false);
      }
    };

  /**
   * ============================================================
   * INITIAL DATABASE LOAD + ROLE CHANGE
   * ============================================================
   */
  useEffect(() => {
    loadDatabaseRecords();
  }, [roleMode]);

  /**
   * ============================================================
   * PUBLIC BUILDING SELECTED FROM MAP
   * ============================================================
   */
  const handlePublicBuildingSelect =
    (
      selectedBuilding: ParsedBuilding
    ) => {
      setBuilding(
        selectedBuilding
      );

      setSelectedProperty(
        null
      );

      setVerification(null);

      sessionStorage.setItem(
        "activeBuildingData",
        JSON.stringify(
          selectedBuilding
        )
      );

      /**
       * Scroll to the selected-building
       * section after rendering.
       */
      window.setTimeout(() => {
        document
          .getElementById(
            "selected-building-view"
          )
          ?.scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
      }, 50);
    };

  /**
   * ============================================================
   * BACK TO PUBLIC MAP
   * ============================================================
   */
  const handleBackToMap = () => {
    setBuilding(null);

    setSelectedProperty(
      null
    );

    setVerification(null);

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  };

  /**
   * ============================================================
   * FILE UPLOADER
   * ============================================================
   */
  const handleParsed = async (
    parsedBuilding: ParsedBuilding
  ) => {
    console.log(
      "Uploaded ParsedBuilding:",
      parsedBuilding
    );

    console.log(
      "Uploaded GeoReference:",
      parsedBuilding.georeference
    );

    /**
     * Immediately display uploaded
     * building.
     */
    setBuilding(
      parsedBuilding
    );

    setSelectedProperty(
      null
    );

    setShowUploader(
      false
    );

    try {
      const res =
        await savePendingBuilding(
          parsedBuilding
        );

      if (res.success) {
        alert(
          "Plan saved to database queue with updated coordinates as PENDING_REVIEW!"
        );

        /**
         * Refresh DB records.
         */
        await loadDatabaseRecords();
      } else {
        alert(
          "Upload failed."
        );
      }
    } catch (error) {
      console.error(
        "Upload/save error:",
        error
      );

      alert(
        "Upload failed."
      );
    }
  };

  /**
   * ============================================================
   * STATUS CHANGE
   * ============================================================
   */
  const handleStatusChange = async (
    buildingId: string,
    newStatus:
      | "PENDING_REVIEW"
      | "REJECTED"
  ) => {
    try {
      const res =
        await updateBuildingStatus(
          buildingId,
          newStatus
        );

      if (res.success) {
        await loadDatabaseRecords();
      } else {
        alert(
          "Failed to update building status."
        );
      }
    } catch (error) {
      console.error(
        "Status update error:",
        error
      );

      alert(
        "Failed to update building status."
      );
    }
  };

  /**
   * ============================================================
   * DELETE BUILDING
   * ============================================================
   */
  const handleDelete = async (
    buildingId: string
  ) => {
    if (
      !confirm(
        "Are you sure you want to permanently delete this cadastral submission?"
      )
    ) {
      return;
    }

    try {
      const res =
        await deleteBuilding(
          buildingId
        );

      if (res.success) {
        if (
          building?.id ===
          buildingId
        ) {
          setBuilding(null);

          setSelectedProperty(
            null
          );
        }

        await loadDatabaseRecords();
      } else {
        alert(
          "Deletion failed."
        );
      }
    } catch (error) {
      console.error(
        "Delete error:",
        error
      );

      alert(
        "Deletion failed."
      );
    }
  };

  /**
   * ============================================================
   * SURVEYOR VERIFICATION
   * ============================================================
   */
  const handleVerificationComplete =
    async (
      data: SurveyorVerificationData
    ) => {
      setVerification(
        data
      );

      if (
        building?.id &&
        data.status ===
          "APPROVED"
      ) {
        try {
          const res =
            await approveBuilding(
              building.id,
              "SURVEYOR-OFFICER-01"
            );

          if (res.success) {
            alert(
              "Building approved & assigned official ULPINs in PostgreSQL!"
            );

            await loadDatabaseRecords();
          } else {
            alert(
              "Database approval failed."
            );
          }
        } catch (error) {
          console.error(
            "Approval error:",
            error
          );

          alert(
            "Database approval failed."
          );
        }
      }
    };

  /**
   * ============================================================
   * PROPERTY NAVIGATION
   * ============================================================
   */
  const handlePropertyNavigate = (
    property:
      | Property2D
      | string
  ) => {
    const propId =
      typeof property ===
      "string"
        ? property
        : property.id;

    setSelectedProperty(
      propId
    );

    if (building) {
      sessionStorage.setItem(
        "activeBuildingData",
        JSON.stringify(
          building
        )
      );
    }

    if (propId) {
      router.push(
        `/properties/${propId}`
      );
    }
  };

  /**
   * ============================================================
   * PROPERTY SELECTION
   * ============================================================
   */
  const handlePropertySelect = (
    property:
      | Property2D
      | string
  ) => {
    const propId =
      typeof property ===
      "string"
        ? property
        : property.id;

    setSelectedProperty(
      propId
    );

    if (building) {
      sessionStorage.setItem(
        "activeBuildingData",
        JSON.stringify(
          building
        )
      );
    }
  };

  /**
   * ============================================================
   * RENDER
   * ============================================================
   */
  return (
    <main
      style={{
        minHeight: "100vh",
        width: "100%",
        maxWidth: "100vw",

        overflowX:
          "hidden",

        overflowY:
          "auto",

        background:
          "#090d16",

        color:
          "#f8fafc",

        display:
          "flex",

        flexDirection:
          "column",

        fontFamily:
          "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",

        boxSizing:
          "border-box",
      }}
    >
      {/* ======================================================
          HEADER
          ====================================================== */}

      <header
        style={{
          height:
            "70px",

          minHeight:
            "70px",

          padding:
            "0 28px",

          background:
            "rgba(15,23,42,0.95)",

          backdropFilter:
            "blur(12px)",

          borderBottom:
            "1px solid #1e293b",

          display:
            "flex",

          alignItems:
            "center",

          justifyContent:
            "space-between",

          position:
            "sticky",

          top: 0,

          zIndex: 50,

          boxSizing:
            "border-box",
        }}
      >
        {/* BRAND */}

        <div
          style={{
            display:
              "flex",

            alignItems:
              "center",

            gap:
              "12px",
          }}
        >
          <div
            style={{
              width:
                "40px",

              height:
                "40px",

              borderRadius:
                "9px",

              background:
                "linear-gradient(135deg,#2563eb,#1d4ed8)",

              display:
                "flex",

              alignItems:
                "center",

              justifyContent:
                "center",

              fontWeight:
                800,

              color:
                "#ffffff",
            }}
          >
            3D
          </div>

          <div>
            <div
              style={{
                fontSize:
                  "17px",

                fontWeight:
                  800,
              }}
            >
              3D ULPIN Engine
            </div>

            <div
              style={{
                fontSize:
                  "10px",

                color:
                  "#94a3b8",
              }}
            >
              Volumetric Cadastre &
              Vertical Land Governance
            </div>
          </div>
        </div>

        {/* ====================================================
            ROLE SWITCHER
            ==================================================== */}

        <div
          style={{
            display:
              "flex",

            background:
              "#0f172a",

            padding:
              "4px",

            borderRadius:
              "10px",

            border:
              "1px solid #1e293b",
          }}
        >
          {/* PUBLIC */}

          <button
            type="button"
            onClick={() => {
              setRoleMode(
                "PUBLIC_VIEWER"
              );

              setBuilding(
                null
              );

              setSelectedProperty(
                null
              );

              setVerification(
                null
              );
            }}
            style={{
              padding:
                "7px 14px",

              borderRadius:
                "7px",

              border:
                "none",

              background:
                roleMode ===
                "PUBLIC_VIEWER"
                  ? "#2563eb"
                  : "transparent",

              color:
                roleMode ===
                "PUBLIC_VIEWER"
                  ? "#ffffff"
                  : "#94a3b8",

              fontSize:
                "12px",

              fontWeight:
                700,

              cursor:
                "pointer",
            }}
          >
            👁 Public Viewer
          </button>

          {/* SURVEYOR */}

          <button
            type="button"
            onClick={() =>
              setRoleMode(
                "SURVEYOR"
              )
            }
            style={{
              padding:
                "7px 14px",

              borderRadius:
                "7px",

              border:
                "none",

              background:
                roleMode ===
                "SURVEYOR"
                  ? "#059669"
                  : "transparent",

              color:
                roleMode ===
                "SURVEYOR"
                  ? "#ffffff"
                  : "#94a3b8",

              fontSize:
                "12px",

              fontWeight:
                700,

              cursor:
                "pointer",
            }}
          >
            🛡 Surveyor Portal
          </button>

          {/* UPLOADER */}

          <button
            type="button"
            onClick={() =>
              setRoleMode(
                "UPLOADER"
              )
            }
            style={{
              padding:
                "7px 14px",

              borderRadius:
                "7px",

              border:
                "none",

              background:
                roleMode ===
                "UPLOADER"
                  ? "#d97706"
                  : "transparent",

              color:
                roleMode ===
                "UPLOADER"
                  ? "#ffffff"
                  : "#94a3b8",

              fontSize:
                "12px",

              fontWeight:
                700,

              cursor:
                "pointer",
            }}
          >
            📤 Uploader Portal
          </button>
        </div>
      </header>

      {/* ======================================================
          UPLOADER MODAL
          ====================================================== */}

      {showUploader && (
        <div
          style={{
            position:
              "fixed",

            inset:
              0,

            zIndex:
              100,

            background:
              "rgba(2,6,23,0.75)",

            backdropFilter:
              "blur(6px)",

            display:
              "flex",

            alignItems:
              "center",

            justifyContent:
              "center",

            padding:
              "20px",
          }}
        >
          <div
            style={{
              background:
                "#0f172a",

              border:
                "1px solid #1e293b",

              borderRadius:
                "16px",

              padding:
                "28px",

              width:
                "100%",

              maxWidth:
                "550px",

              boxShadow:
                "0 25px 50px -12px rgba(0,0,0,0.5)",
            }}
          >
            <div
              style={{
                display:
                  "flex",

                justifyContent:
                  "space-between",

                alignItems:
                  "center",

                marginBottom:
                  "20px",
              }}
            >
              <h2
                style={{
                  margin:
                    0,

                  fontSize:
                    "18px",

                  fontWeight:
                    800,

                  color:
                    "#f8fafc",
                }}
              >
                Upload Field Plan
              </h2>

              <button
                type="button"
                onClick={() =>
                  setShowUploader(
                    false
                  )
                }
                style={{
                  border:
                    "none",

                  background:
                    "#1e293b",

                  color:
                    "#94a3b8",

                  borderRadius:
                    "6px",

                  padding:
                    "6px 10px",

                  cursor:
                    "pointer",
                }}
              >
                ✕
              </button>
            </div>

            <FileUploader
              onParsed={
                handleParsed
              }
            />
          </div>
        </div>
      )}

      {/* ======================================================
          MAIN CONTENT
          ====================================================== */}

      <div
        style={{
          flex:
            "1 1 auto",

          width:
            "100%",

          maxWidth:
            "1500px",

          margin:
            "0 auto",

          padding:
            "24px 28px 40px",

          boxSizing:
            "border-box",

          minWidth:
            0,
        }}
      >
        {/* ====================================================
            SURVEYOR PORTAL
            ==================================================== */}

        {roleMode ===
        "SURVEYOR" ? (
          <div
            style={{
              display:
                "grid",

              gridTemplateColumns:
                "360px minmax(0,1fr)",

              gap:
                "24px",

              minWidth:
                0,
            }}
          >
            {/* SURVEYOR RECORDS */}

            <aside
              style={{
                background:
                  "rgba(15,23,42,0.6)",

                border:
                  "1px solid #1e293b",

                borderRadius:
                  "12px",

                padding:
                  "18px",

                maxHeight:
                  "calc(100vh - 120px)",

                overflowY:
                  "auto",
              }}
            >
              <div
                style={{
                  display:
                    "flex",

                  justifyContent:
                    "space-between",

                  alignItems:
                    "center",

                  marginBottom:
                    "16px",
                }}
              >
                <h3
                  style={{
                    margin:
                      0,

                    fontSize:
                      "15px",

                    fontWeight:
                      800,

                    color:
                      "#38bdf8",
                  }}
                >
                  📋 Managed Records (
                  {
                    buildingList.length
                  }
                  )
                </h3>

                <button
                  type="button"
                  onClick={() =>
                    setShowUploader(
                      true
                    )
                  }
                  style={{
                    background:
                      "#2563eb",

                    border:
                      "none",

                    color:
                      "#fff",

                    fontSize:
                      "11px",

                    fontWeight:
                      700,

                    padding:
                      "6px 10px",

                    borderRadius:
                      "6px",

                    cursor:
                      "pointer",
                  }}
                >
                  + Add Plan
                </button>
              </div>

              {loadingDb ? (
                <p
                  style={{
                    fontSize:
                      "12px",

                    color:
                      "#94a3b8",
                  }}
                >
                  Querying
                  database...
                </p>
              ) : buildingList.length ===
                0 ? (
                <p
                  style={{
                    fontSize:
                      "12px",

                    color:
                      "#94a3b8",
                  }}
                >
                  No cadastral
                  submissions
                  found.
                </p>
              ) : (
                buildingList.map(
                  (item) => (
                    <div
                      key={
                        item.id
                      }

                      onClick={() =>
                        setBuilding(
                          mapDbToParsedBuilding(
                            item
                          )
                        )
                      }

                      style={{
                        padding:
                          "12px",

                        borderRadius:
                          "8px",

                        marginBottom:
                          "12px",

                        background:
                          building?.id ===
                          item.id
                            ? "#1e293b"
                            : "#0f172a",

                        border:
                          building?.id ===
                          item.id
                            ? "1px solid #3b82f6"
                            : "1px solid #1e293b",

                        cursor:
                          "pointer",
                      }}
                    >
                      <div
                        style={{
                          display:
                            "flex",

                          justifyContent:
                            "space-between",

                          alignItems:
                            "center",
                        }}
                      >
                        <span
                          style={{
                            fontSize:
                              "13px",

                            fontWeight:
                              700,
                          }}
                        >
                          {
                            item.name
                          }
                        </span>

                        <span
                          style={{
                            fontSize:
                              "10px",

                            fontWeight:
                              800,

                            padding:
                              "2px 6px",

                            borderRadius:
                              "4px",

                            background:
                              item.approvalStatus ===
                              "APPROVED"
                                ? "#065f46"
                                : item.approvalStatus ===
                                    "REJECTED"
                                  ? "#881337"
                                  : "#854d0e",

                            color:
                              "#ffffff",
                          }}
                        >
                          {
                            item.approvalStatus
                          }
                        </span>
                      </div>

                      <div
                        style={{
                          marginTop:
                            "10px",

                          display:
                            "flex",

                          gap:
                            "6px",

                          flexWrap:
                            "wrap",
                        }}
                      >
                        <button
                          type="button"
                          onClick={(
                            e
                          ) => {
                            e.stopPropagation();

                            handleStatusChange(
                              item.id,
                              "PENDING_REVIEW"
                            );
                          }}
                          style={{
                            background:
                              "#334155",

                            border:
                              "none",

                            color:
                              "#cbd5e1",

                            fontSize:
                              "10px",

                            padding:
                              "4px 8px",

                            borderRadius:
                              "4px",

                            cursor:
                              "pointer",
                          }}
                        >
                          Reset Pending
                        </button>

                        <button
                          type="button"
                          onClick={(
                            e
                          ) => {
                            e.stopPropagation();

                            handleStatusChange(
                              item.id,
                              "REJECTED"
                            );
                          }}
                          style={{
                            background:
                              "#991b1b",

                            border:
                              "none",

                            color:
                              "#ffffff",

                            fontSize:
                              "10px",

                            padding:
                              "4px 8px",

                            borderRadius:
                              "4px",

                            cursor:
                              "pointer",
                          }}
                        >
                          Reject
                        </button>

                        <button
                          type="button"
                          onClick={(
                            e
                          ) => {
                            e.stopPropagation();

                            handleDelete(
                              item.id
                            );
                          }}
                          style={{
                            background:
                              "#450a0a",

                            border:
                              "none",

                            color:
                              "#f87171",

                            fontSize:
                              "10px",

                            padding:
                              "4px 8px",

                            borderRadius:
                              "4px",

                            cursor:
                              "pointer",
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  )
                )
              )}
            </aside>

            {/* SURVEYOR INSPECTION */}

            <section
              style={{
                display:
                  "flex",

                flexDirection:
                  "column",

                gap:
                  "20px",

                minWidth:
                  0,
              }}
            >
              {building ? (
                <>
                  <TopologyValidator
                    building={
                      building
                    }
                  />

                  <SurveyorApprovalPanel
                    building={
                      building
                    }
                    onVerificationComplete={
                      handleVerificationComplete
                    }
                  />

                  <div
                    style={{
                      position:
                        "relative",

                      width:
                        "100%",

                      height:
                        "650px",

                      borderRadius:
                        "14px",

                      overflow:
                        "hidden",

                      border:
                        "1px solid #1e293b",
                    }}
                  >
                    <RealWorldMapViewer
                      key={
                        building.id
                      }

                      building={
                        building
                      }

                      approvalStatus={
                        verification?.status ||
                        "PENDING_REVIEW"
                      }

                      onPropertyNavigate={
                        handlePropertyNavigate
                      }

                      onPropertySelect={
                        handlePropertySelect
                      }
                    />
                  </div>
                </>
              ) : (
                <div
                  style={{
                    textAlign:
                      "center",

                    padding:
                      "80px",

                    color:
                      "#94a3b8",
                  }}
                >
                  Select an upload
                  from the left
                  panel to inspect
                  and manage.
                </div>
              )}
            </section>
          </div>
        ) : (
          /* ==================================================
             PUBLIC / UPLOADER
             ================================================== */

          <div
            style={{
              display:
                "flex",

              flexDirection:
                "column",

              gap:
                "24px",

              width:
                "100%",

              minWidth:
                0,
            }}
          >
            {/* ==================================================
                PUBLIC VIEWER
                ================================================== */}

            {roleMode ===
              "PUBLIC_VIEWER" && (
              <>
                {!building ? (
                  /**
                   * =================================================
                   * MAP-FIRST PUBLIC VIEWER
                   * =================================================
                   *
                   * Every database building is visible.
                   */
                  <section
                    style={{
                      width:
                        "100%",

                      height:
                        "calc(100vh - 125px)",

                      minHeight:
                        "700px",

                      maxHeight:
                        "900px",

                      borderRadius:
                        "18px",

                      overflow:
                        "hidden",

                      border:
                        "1px solid #1e293b",

                      boxShadow:
                        "0 15px 40px rgba(0,0,0,0.2)",
                    }}
                  >
                    {loadingDb ? (
                      <div
                        style={{
                          width:
                            "100%",

                          height:
                            "100%",

                          minHeight:
                            "700px",

                          display:
                            "flex",

                          alignItems:
                            "center",

                          justifyContent:
                            "center",

                          background:
                            "#e2e8f0",

                          color:
                            "#334155",

                          fontSize:
                            "14px",

                          fontWeight:
                            700,
                        }}
                      >
                        Loading cadastral
                        structures...
                      </div>
                    ) : publicMapBuildings.length >
                      0 ? (
                      <RealWorldMapViewer
                        buildings={
                          publicMapBuildings
                        }

                        onBuildingSelect={
                          handlePublicBuildingSelect
                        }
                      />
                    ) : (
                      <div
                        style={{
                          width:
                            "100%",

                          height:
                            "100%",

                          minHeight:
                            "700px",

                          display:
                            "flex",

                          alignItems:
                            "center",

                          justifyContent:
                            "center",

                          background:
                            "#e2e8f0",

                          color:
                            "#334155",

                          textAlign:
                            "center",

                          padding:
                            "30px",
                        }}
                      >
                        <div>
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
                            No map-ready cadastral
                            structures found
                          </div>

                          <div
                            style={{
                              marginTop:
                                "8px",

                              fontSize:
                                "13px",

                              color:
                                "#64748b",

                              maxWidth:
                                "500px",
                            }}
                          >
                            The database contains{" "}
                            {
                              buildingList.length
                            }{" "}
                            record
                            {buildingList.length ===
                            1
                              ? ""
                              : "s"}
                            , but none currently
                            have valid latitude and
                            longitude coordinates.
                          </div>
                        </div>
                      </div>
                    )}
                  </section>
                ) : (
                  /**
                   * =================================================
                   * SELECTED BUILDING
                   * =================================================
                   */
                  <div
                    id="selected-building-view"
                    style={{
                      display:
                        "flex",

                      flexDirection:
                        "column",

                      gap:
                        "24px",
                    }}
                  >
                    {/* BACK TO MAP */}

                    <button
                      type="button"
                      onClick={
                        handleBackToMap
                      }
                      style={{
                        alignSelf:
                          "flex-start",

                        padding:
                          "9px 15px",

                        borderRadius:
                          "9px",

                        border:
                          "1px solid #334155",

                        background:
                          "#111827",

                        color:
                          "#cbd5e1",

                        fontSize:
                          "12px",

                        fontWeight:
                          700,

                        cursor:
                          "pointer",
                      }}
                    >
                      ← Back to Map
                    </button>

                    {/* BUILDING HEADER */}

                    <section
                      style={{
                        background:
                          "linear-gradient(135deg,#111827,#0f172a)",

                        border:
                          "1px solid #263247",

                        borderRadius:
                          "16px",

                        padding:
                          "22px",

                        boxShadow:
                          "0 10px 30px rgba(0,0,0,0.12)",
                      }}
                    >
                      <div
                        style={{
                          display:
                            "flex",

                          justifyContent:
                            "space-between",

                          alignItems:
                            "center",

                          gap:
                            "20px",

                          flexWrap:
                            "wrap",
                        }}
                      >
                        <div>
                          <div
                            style={{
                              fontSize:
                                "25px",

                              fontWeight:
                                800,

                              color:
                                "#f8fafc",
                            }}
                          >
                            {
                              building.name
                            }
                          </div>

                          <div
                            style={{
                              marginTop:
                                "6px",

                              fontSize:
                                "12px",

                              color:
                                "#94a3b8",
                            }}
                          >
                            {
                              building.address ||
                              "Cadastral building"
                            }
                          </div>

                          {building.georeference && (
                            <div
                              style={{
                                marginTop:
                                  "7px",

                                fontSize:
                                  "10px",

                                color:
                                  "#64748b",
                              }}
                            >
                              📍{" "}
                              {building.georeference.latitude.toFixed(
                                6
                              )}
                              ,{" "}
                              {building.georeference.longitude.toFixed(
                                6
                              )}
                            </div>
                          )}
                        </div>

                        <div
                          style={{
                            padding:
                              "7px 11px",

                            borderRadius:
                              "999px",

                            background:
                              "#064e3b",

                            color:
                              "#6ee7b7",

                            fontSize:
                              "10px",

                            fontWeight:
                              800,
                          }}
                        >
                          ✓ VERIFIED RECORD
                        </div>
                      </div>
                    </section>

                    {/* ULPIN SEARCH */}

                    <ULPINSearch
                      building={
                        building
                      }

                      onSelectProperty={(
                        id
                      ) =>
                        handlePropertyNavigate(
                          id
                        )
                      }
                    />

                    {/* ==================================================
                        3D + CADASTRAL GRAPH
                        ================================================== */}

                    <div
                      style={{
                        display:
                          "grid",

                        gridTemplateColumns:
                          "minmax(0,1fr) minmax(0,1fr)",

                        gap:
                          "20px",

                        width:
                          "100%",
                      }}
                    >
                      {/* 3D MODEL */}

                      <section
                        style={{
                          background:
                            "rgba(15,23,42,0.6)",

                          border:
                            "1px solid #1e293b",

                          borderRadius:
                            "12px",

                          padding:
                            "20px",

                          minWidth:
                            0,

                          overflow:
                            "hidden",
                        }}
                      >
                        <div
                          style={{
                            fontSize:
                              "16px",

                            fontWeight:
                              800,
                          }}
                        >
                          3D Building Model
                        </div>

                        <div
                          style={{
                            marginTop:
                              "16px",

                            height:
                              "460px",

                            borderRadius:
                              "10px",

                            overflow:
                              "hidden",

                            background:
                              "#020617",

                            border:
                              "1px solid #1e293b",
                          }}
                        >
                          <VolumetricViewer
                            building={
                              building
                            }

                            selectedPropertyId={
                              selectedProperty
                            }

                            onPropertySelect={(
                              property
                            ) =>
                              handlePropertySelect(
                                property.id
                              )
                            }
                          />
                        </div>
                      </section>

                      {/* CADASTRAL GRAPH */}

                      <section
                        style={{
                          background:
                            "rgba(15,23,42,0.6)",

                          border:
                            "1px solid #1e293b",

                          borderRadius:
                            "12px",

                          padding:
                            "20px",

                          minWidth:
                            0,

                          overflow:
                            "hidden",
                        }}
                      >
                        <div
                          style={{
                            display:
                              "flex",

                            justifyContent:
                              "space-between",

                            alignItems:
                              "center",
                          }}
                        >
                          <div
                            style={{
                              fontSize:
                                "16px",

                              fontWeight:
                                800,
                            }}
                          >
                            Cadastral Graph
                          </div>

                          <div
                            style={{
                              padding:
                                "4px 8px",

                              borderRadius:
                                "999px",

                              background:
                                "#172033",

                              color:
                                "#93c5fd",

                              fontSize:
                                "9px",

                              fontWeight:
                                700,
                            }}
                          >
                            SELECTED
                          </div>
                        </div>

                        <div
                          style={{
                            marginTop:
                              "16px",

                            height:
                              "460px",

                            borderRadius:
                              "10px",

                            overflow:
                              "auto",

                            background:
                              "#020617",

                            border:
                              "1px solid #1e293b",
                          }}
                        >
                          <CadastralGraph
                            building={
                              building
                            }

                            selectedNodeId={
                              selectedProperty
                            }

                            onNodeSelect={(
                              nodeId
                            ) =>
                              handlePropertySelect(
                                nodeId
                              )
                            }
                          />
                        </div>
                      </section>
                    </div>

                    {/* ==================================================
                        SELECTED BUILDING MAP
                        ================================================== */}

                    <section>
                      <div
                        style={{
                          display:
                            "flex",

                          justifyContent:
                            "space-between",

                          alignItems:
                            "center",

                          marginBottom:
                            "12px",
                        }}
                      >
                        <div
                          style={{
                            fontSize:
                              "17px",

                            fontWeight:
                              800,
                          }}
                        >
                          Real-World Cadastral
                          Map
                        </div>

                        <div
                          style={{
                            fontSize:
                              "11px",

                            color:
                              "#64748b",
                          }}
                        >
                          Selected building
                        </div>
                      </div>

                      <div
                        style={{
                          height:
                            "700px",

                          width:
                            "100%",

                          borderRadius:
                            "16px",

                          overflow:
                            "hidden",

                          border:
                            "1px solid #1e293b",
                        }}
                      >
                        <RealWorldMapViewer
                          key={
                            building.id
                          }

                          building={
                            building
                          }

                          approvalStatus="APPROVED"

                          onPropertyNavigate={
                            handlePropertyNavigate
                          }

                          onPropertySelect={
                            handlePropertySelect
                          }
                        />
                      </div>
                    </section>

                    {/* EXPORT */}

                    <ExportPanel
                      building={
                        building
                      }
                    />
                  </div>
                )}
              </>
            )}

            {/* ==================================================
                UPLOADER PORTAL
                ================================================== */}

            {roleMode ===
              "UPLOADER" && (
              <section
                style={{
                  background:
                    "rgba(15,23,42,0.6)",

                  padding:
                    "24px",

                  borderRadius:
                    "12px",

                  border:
                    "1px solid #1e293b",
                }}
              >
                <h3
                  style={{
                    margin:
                      "0 0 6px",

                    fontSize:
                      "18px",

                    color:
                      "#f8fafc",
                  }}
                >
                  Upload Revisions &
                  Field Drawings
                </h3>

                <div
                  style={{
                    marginBottom:
                      "18px",

                    fontSize:
                      "11px",

                    color:
                      "#64748b",
                  }}
                >
                  Submit cadastral plans
                  for surveyor verification.
                </div>

                <FileUploader
                  onParsed={
                    handleParsed
                  }
                />
              </section>
            )}
          </div>
        )}
      </div>
    </main>
  );
}


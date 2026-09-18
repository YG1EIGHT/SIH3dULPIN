"use server";

import { prisma } from "@/src/lib/prisma";
import { revalidatePath } from "next/cache";
import type { ParsedBuilding } from "@/src/lib/parser/types";
import { cookies } from "next/headers";
import { verifySession } from "@/src/lib/auth";

async function requireSurveyor() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get("session")?.value;

  if (!sessionToken) {
    return {
      authorized: false as const,
      status: 401,
      error: "Authentication required.",
    };
  }

  const user = await verifySession(sessionToken);

  if (!user) {
    return {
      authorized: false as const,
      status: 401,
      error: "Invalid or expired session.",
    };
  }

  if (user.role !== "SURVEYOR") {
    return {
      authorized: false as const,
      status: 403,
      error: "Surveyor access required.",
    };
  }

  return {
    authorized: true as const,
    user,
  };
}

// 1. PUBLIC VIEWER: Fetch ONLY approved buildings
export async function getPublicVerifiedBuildings() {
  try {
    const buildings = await prisma.building.findMany({
      where: { approvalStatus: "APPROVED" },
      include: {
        floors: {
          orderBy: { floorNumber: "asc" },
          include: { units: true },
        },
      },
    });

    return { success: true, data: buildings };
  } catch (error) {
    console.error("Error fetching public buildings:", error);
    return { success: false, data: [] };
  }
}

// 2. SURVEYOR PORTAL: Fetch ALL buildings regardless of status
export async function getAllBuildings() {
  const auth = await requireSurveyor();

  if (!auth.authorized) {
    return {
      success: false,
      data: [],
      error: auth.error,
    };
  }

  try {
    const buildings = await prisma.building.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        floors: {
          orderBy: { floorNumber: "asc" },
          include: { units: true },
        },
      },
    });

    return { success: true, data: buildings };
  } catch (error) {
    console.error("Error fetching all buildings:", error);
    return { success: false, data: [] };
  }
}

// 3. UPLOADER PORTAL: Persist newly parsed plan as PENDING_REVIEW
export async function savePendingBuilding(parsedBuilding: ParsedBuilding) {
  try {
    const created = await prisma.building.create({
      data: {
        id: parsedBuilding.id,
        name: parsedBuilding.name || "Uploaded Cadastral Plan",
        latitude: parsedBuilding.georeference?.latitude ?? 18.5204,
        longitude: parsedBuilding.georeference?.longitude ?? 73.8567,
        approvalStatus: "PENDING_REVIEW",
        floors: {
          create: (parsedBuilding.floors || []).map((floor) => ({
            floorNumber: floor.floorNumber,
            elevation: floor.elevation ?? 0,
            height: floor.height ?? 3.2,
            units: {
              create: (floor.units || []).map((unit) => ({
                id: unit.id,
                unitNumber: unit.unitNumber || unit.id,
                area: unit.area ?? 0,
                spaceType: unit.spaceType || "RESIDENTIAL",
                polygon:
                  typeof unit.polygon === "string"
                    ? unit.polygon
                    : JSON.stringify(unit.polygon),
                ulpin: unit.ulpin || null,
              })),
            },
          })),
        },
      },
    });

    revalidatePath("/");
    return { success: true, data: created };
  } catch (error) {
    console.error("Error saving pending building:", error);
    return {
      success: false,
      error: "Failed to persist building draft.",
    };
  }
}

// 4. SURVEYOR PORTAL: Approve building and auto-generate ULPINs
export async function approveBuilding(buildingId: string) {
  const auth = await requireSurveyor();

  if (!auth.authorized) {
    return {
      success: false,
      error: auth.error,
    };
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const updatedBuilding = await tx.building.update({
        where: { id: buildingId },
        data: {
          approvalStatus: "APPROVED",
          surveyorId: auth.user.id,
          verifiedAt: new Date(),
        },
        include: {
          floors: { include: { units: true } },
        },
      });

      const unitDelegate = (tx as any).property || (tx as any).unit;

      for (const floor of updatedBuilding.floors) {
        for (const unit of floor.units) {
          const generatedULPIN =
            unit.ulpin ||
            `14-4012-${buildingId.slice(0, 4)}-3D-F${floor.floorNumber}-${unit.unitNumber}`;

          if (unitDelegate) {
            await unitDelegate.update({
              where: { id: unit.id },
              data: { ulpin: generatedULPIN },
            });
          }
        }
      }

      return updatedBuilding;
    });

    revalidatePath("/");
    return { success: true, data: result };
  } catch (error) {
    console.error("Failed to approve building:", error);
    return {
      success: false,
      error: "Approval transaction failed",
    };
  }
}

// 5. SURVEYOR PORTAL: Update status manually
export async function updateBuildingStatus(
  buildingId: string,
  status: "PENDING_REVIEW" | "REJECTED"
) {
  const auth = await requireSurveyor();

  if (!auth.authorized) {
    return {
      success: false,
      error: auth.error,
    };
  }

  try {
    const updated = await prisma.building.update({
      where: { id: buildingId },
      data: { approvalStatus: status },
    });

    revalidatePath("/");
    return { success: true, data: updated };
  } catch (error) {
    console.error("Failed to update status:", error);
    return {
      success: false,
      error: "Update failed",
    };
  }
}

// 6. SURVEYOR PORTAL: Delete building upload permanently
export async function deleteBuilding(buildingId: string) {
  const auth = await requireSurveyor();

  if (!auth.authorized) {
    return {
      success: false,
      error: auth.error,
    };
  }

  try {
    await prisma.building.delete({
      where: { id: buildingId },
    });

    revalidatePath("/");
    return { success: true };
  } catch (error) {
    console.error("Failed to delete building:", error);
    return {
      success: false,
      error: "Deletion failed",
    };
  }
}
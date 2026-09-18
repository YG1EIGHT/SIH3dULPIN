import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "@/src/lib/auth";

export interface ParcelSubmission {
  id: string;
  applicantName: string;
  surfaceParcelId: string;
  buildingData: any;
  status: "PENDING_REVIEW" | "APPROVED" | "REJECTED" | "REVISION_REQUIRED";
  submittedAt: string;
  surveyorNotes?: string;
  georeference: {
    latitude: number;
    longitude: number;
    elevationOffset: number;
  };
}

// In-memory mock storage for pending surveyor reviews
const pendingSubmissions: Map<string, ParcelSubmission> = new Map();

async function requireSurveyor() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get("session")?.value;

  if (!sessionToken) {
    return {
      authorized: false,
      response: NextResponse.json(
        { success: false, error: "Authentication required." },
        { status: 401 }
      ),
    };
  }

  const user = await verifySession(sessionToken);

  if (!user) {
    return {
      authorized: false,
      response: NextResponse.json(
        { success: false, error: "Invalid or expired session." },
        { status: 401 }
      ),
    };
  }

  if (user.role !== "SURVEYOR") {
    return {
      authorized: false,
      response: NextResponse.json(
        { success: false, error: "Surveyor access required." },
        { status: 403 }
      ),
    };
  }

  return {
    authorized: true,
    user,
  };
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { applicantName, surfaceParcelId, buildingData, georeference } = body;

    const submissionId = `SUB-${Date.now().toString().slice(-6)}`;

    const submission: ParcelSubmission = {
      id: submissionId,
      applicantName: applicantName || "Anonymous Citizen",
      surfaceParcelId: surfaceParcelId || "PARCEL-4012",
      buildingData,
      status: "PENDING_REVIEW",
      submittedAt: new Date().toISOString(),
      georeference:
        georeference || {
          latitude: 18.5204,
          longitude: 73.8567,
          elevationOffset: 0,
        },
    };

    pendingSubmissions.set(submissionId, submission);

    return NextResponse.json({
      success: true,
      message:
        "Field data submitted successfully. Pending Cadastral Surveyor approval.",
      submissionId,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: "Invalid submission data" },
      { status: 400 }
    );
  }
}

export async function PATCH(request: Request) {
  const auth = await requireSurveyor();

  if (!auth.authorized) {
    return auth.response;
  }

  try {
    const body = await request.json();
    const { submissionId, status, surveyorNotes } = body;

    const submission = pendingSubmissions.get(submissionId);

    if (!submission) {
      return NextResponse.json(
        { success: false, error: "Submission not found" },
        { status: 404 }
      );
    }

    submission.status = status;
    submission.surveyorNotes = surveyorNotes;
    pendingSubmissions.set(submissionId, submission);

    return NextResponse.json({
      success: true,
      message: `Parcel status updated to ${status}`,
      submission,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: "Failed to update review status" },
      { status: 500 }
    );
  }
}

export async function GET() {
  const auth = await requireSurveyor();

  if (!auth.authorized) {
    return auth.response;
  }

  return NextResponse.json(Array.from(pendingSubmissions.values()));
}
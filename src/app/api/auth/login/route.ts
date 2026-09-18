
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/src/lib/prisma";
import { createSession } from "@/src/lib/auth";

type LoginRole = "VIEWER" | "SURVEYOR";

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const email = body.email?.trim().toLowerCase();
    const password = body.password;
    const requestedRole = body.role as LoginRole;

    if (!email || !password || !requestedRole) {
      return NextResponse.json(
        {
          success: false,
          error: "Email, password, and login role are required.",
        },
        { status: 400 }
      );
    }

    if (requestedRole !== "VIEWER" && requestedRole !== "SURVEYOR") {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid login role.",
        },
        { status: 400 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid email, password, or login role.",
        },
        { status: 401 }
      );
    }

    const passwordMatches = await bcrypt.compare(
      password,
      user.passwordHash
    );

    if (!passwordMatches) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid email, password, or login role.",
        },
        { status: 401 }
      );
    }

    // The selected login role must match the user's actual database role.
    if (user.role !== requestedRole) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid email, password, or login role.",
        },
        { status: 401 }
      );
    }

    const sessionToken = await createSession({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    });

    const response = NextResponse.json({
      success: true,
      message: "Login successful.",
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });

    response.cookies.set("session", sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7,
      path: "/",
    });

    return response;
  } catch (error) {
    console.error("Login error:", error);

    return NextResponse.json(
      {
        success: false,
        error: "Something went wrong while logging in.",
      },
      { status: 500 }
    );
  }
}


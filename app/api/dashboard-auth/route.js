import { NextResponse } from "next/server";

export async function POST(req) {
  const { password } = await req.json();
  if (password === process.env.DASHBOARD_PASSWORD) {
    const res = NextResponse.json({ success: true });
    res.cookies.set("dashboard_auth", process.env.DASHBOARD_PASSWORD, {
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      maxAge: 60 * 60 * 24 * 7, // 7 days
      path: "/",
    });
    return res;
  }
  return NextResponse.json({ success: false }, { status: 401 });
}

"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, sha256hex } from "@/lib/auth";

export async function login(_prev: { error?: string } | null, formData: FormData): Promise<{ error?: string }> {
  const pw = String(formData.get("password") ?? "");
  const expected = process.env.APP_PASSWORD ?? "";
  if (!expected) return { error: "No password is configured on the server." };
  if (pw !== expected) return { error: "Incorrect password." };

  const jar = await cookies();
  jar.set(SESSION_COOKIE, await sha256hex(expected), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });

  const from = String(formData.get("from") || "/");
  redirect(from.startsWith("/") && !from.startsWith("/login") ? from : "/");
}

export async function logout() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  redirect("/login");
}

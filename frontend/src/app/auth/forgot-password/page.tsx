import type { Metadata } from "next";
import ForgotPasswordForm from "@/components/auth/forgot-password-form";

export const metadata: Metadata = {
  title: "Reset your password",
  description: "Reset your EventHub password using the code emailed to you.",
};

export default function Page() {
  return <ForgotPasswordForm />;
}

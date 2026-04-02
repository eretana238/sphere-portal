import { redirect } from "next/navigation";

/** @deprecated Use /dashboard/tests */
export default function MailSelfTestRedirectPage() {
  redirect("/dashboard/tests");
}

// The sign-in page, named for this assistant (a client's assistant shows its own name).
import LoginForm from "@/components/LoginForm";
import { identity } from "@/lib/kit/kit";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  let id = { assistant: "Jarvis", address: "sir" };
  try {
    id = identity();
  } catch {}
  return <LoginForm name={id.assistant} address={id.address} />;
}

import { Suspense } from "react";
import UserClient from "./UserClient";

export const dynamic = "force-dynamic";

export default function AdminUserPage() {
  return (
    <Suspense fallback={<div className="p-6">Loading...</div>}>
      <UserClient />
    </Suspense>
  );
}

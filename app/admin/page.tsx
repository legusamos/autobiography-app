import { Suspense } from "react";
import AdminClient from "./AdminClient";

export const dynamic = "force-dynamic";

export default function AdminPage() {
  return (
    <Suspense fallback={<div className="p-6">Loading...</div>}>
      <AdminClient />
    </Suspense>
  );
}

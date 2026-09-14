import { scanIp } from "@/lib/popmart";
import Dashboard from "@/components/Dashboard";

// Always render fresh on the server so first paint shows current stock.
export const dynamic = "force-dynamic";

export default async function Page() {
  let initial = null;
  let error: string | null = null;
  try {
    initial = await scanIp("Hirono");
  } catch (e) {
    error = (e as Error).message;
  }

  return <Dashboard initial={initial} initialError={error} />;
}

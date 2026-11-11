import BusinessPage from "@/components/BusinessPage";

export const metadata = { title: "Business · Jarvis" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <BusinessPage id={Number((await params).id)} />;
}

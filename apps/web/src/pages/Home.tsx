import { useAuth } from "../auth";

export function Home() {
  const { user } = useAuth();
  if (!user) return null;
  return (
    <>
      <h1 className="mb-2 text-2xl font-semibold">Olá, {user.displayName}</h1>
      <p>{user.role === "technician" ? "Você está como técnico." : "Você está como solicitante."}</p>
    </>
  );
}

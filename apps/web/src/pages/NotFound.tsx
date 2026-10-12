import { Link } from "react-router";

export function NotFound() {
  return (
    <>
      <h1 className="mb-2 text-2xl font-semibold">Página não encontrada</h1>
      <p>
        <Link to="/" className="text-blue-700 underline">
          Voltar ao início
        </Link>
      </p>
    </>
  );
}

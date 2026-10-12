import { QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { Route, Routes } from "react-router";
import { AuthProvider } from "./auth";
import { Layout } from "./Layout";
import { ArticlePage } from "./pages/ArticlePage";
import { Home } from "./pages/Home";
import { Knowledge } from "./pages/Knowledge";
import { NewTicket } from "./pages/NewTicket";
import { TicketDetail } from "./pages/TicketDetail";
import { Tickets } from "./pages/Tickets";
import { Login } from "./pages/Login";
import { NotFound } from "./pages/NotFound";
import { createQueryClient } from "./queryClient";

// O roteador (BrowserRouter ou MemoryRouter nos testes) vem de fora.
export function App() {
  const [client] = useState(createQueryClient);
  return (
    <QueryClientProvider client={client}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<Layout />}>
            <Route index element={<Home />} />
            <Route path="chamados" element={<Tickets />} />
            <Route path="chamados/novo" element={<NewTicket />} />
            <Route path="chamados/:id" element={<TicketDetail />} />
            <Route path="base" element={<Knowledge />} />
            <Route path="base/:id" element={<ArticlePage />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </AuthProvider>
    </QueryClientProvider>
  );
}

import { Navigate, useLocation } from "react-router-dom";
import { legalDocuments } from "./legalDocuments.js";
import { LegalPage } from "./LegalPage.js";

export function LegalRoute() {
  const { pathname } = useLocation();
  const normalizedPath = pathname.replace(/\/+$/u, "");
  const document = legalDocuments.find((item) => item.path === normalizedPath);

  return document ? <LegalPage document={document} /> : <Navigate to="/" replace />;
}

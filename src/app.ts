import express from "express";
import cors from "cors";
import helmet from "helmet";

export const app = express();

app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL ?? "http://localhost:3000",
}));
app.use(express.json({ limit: "100kb" }));

app.get("/api/v1/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    service: "xtrim-ecommerce-api",
  });
});
import express from "express";
import cors from "cors";
import { nanoid } from "nanoid";
import { db, now } from "./db.js";
import { createHold, capturePaymentIntent, refundPaymentIntent, calculateSplit, isMockMode } from "./payments.js";

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

const PORT = process.env.PORT || 4000;

// ---------- USERS ----------

app.post("/api/users", (req, res) => {
  const { name, role, language = "ru", car_make, car_model, car_plate } = req.body;
  if (!name || !role) return res.status(400).json({ error: "name и role обязательны" });
  const user = {
    id: nanoid(10),
    name,
    role,
    rating: 5,
    rides_count: 0,
    language,
    verified: false,
    car_make: car_make || null,
    car_model: car_model || null,
    car_plate: car_plate || null,
    created_at: now(),
  };
  db.insert("users", user);
  res.json(user);
});

app.get("/api/users/:id", (req, res) => {
  const user = db.findOne("users", (u) => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: "не найден" });
  res.json(user);
});

// Верификация водителя (документы + авто) — упрощённая модель статуса
app.post("/api/users/:id/verify", (req, res) => {
  const { verified } = req.body;
  const updated = db.update("users", (u) => u.id === req.params.id, { verified: !!verified });
  if (!updated) return res.status(404).json({ error: "не найден" });
  res.json(updated);
});

// ---------- TRIPS (заявки пассажиров) ----------

app.post("/api/trips", (req, res) => {
  const { passenger_id, origin, destination, date, seats = 1 } = req.body;
  if (!passenger_id || !origin || !destination || !date)
    return res.status(400).json({ error: "не все поля заполнены" });
  const trip = {
    id: nanoid(10),
    passenger_id,
    origin,
    destination,
    date,
    seats,
    status: "open",
    selected_offer_id: null,
    created_at: now(),
  };
  db.insert("trips", trip);
  res.json(trip);
});

app.get("/api/trips", (req, res) => {
  const { status } = req.query;
  const rows = db
    .find("trips", (t) => (status ? t.status === status : true))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  res.json(rows);
});

app.get("/api/trips/:id", (req, res) => {
  const trip = db.findOne("trips", (t) => t.id === req.params.id);
  if (!trip) return res.status(404).json({ error: "не найдена" });
  const offers = db
    .find("offers", (o) => o.trip_id === trip.id)
    .map((o) => {
      const driver = db.findOne("users", (u) => u.id === o.driver_id);
      return {
        ...o,
        driver_name: driver?.name,
        driver_rating: driver?.rating,
        car_make: driver?.car_make,
        car_model: driver?.car_model,
        driver_verified: driver?.verified,
      };
    })
    .sort((a, b) => a.price_cents - b.price_cents);
  res.json({ ...trip, offers });
});

// ---------- OFFERS (отклики водителей) ----------

app.post("/api/trips/:tripId/offers", (req, res) => {
  const { driver_id, price_cents, currency = "EUR", message } = req.body;
  const trip = db.findOne("trips", (t) => t.id === req.params.tripId);
  if (!trip) return res.status(404).json({ error: "поездка не найдена" });
  if (trip.status !== "open") return res.status(400).json({ error: "поездка уже закрыта для откликов" });

  const offer = {
    id: nanoid(10),
    trip_id: req.params.tripId,
    driver_id,
    price_cents,
    currency,
    message: message || null,
    status: "pending",
    created_at: now(),
  };
  db.insert("offers", offer);
  res.json(offer);
});

// Пассажир выбирает лучшее предложение -> создаём холд оплаты
app.post("/api/offers/:offerId/select", async (req, res) => {
  const offer = db.findOne("offers", (o) => o.id === req.params.offerId);
  if (!offer) return res.status(404).json({ error: "предложение не найдено" });
  const trip = db.findOne("trips", (t) => t.id === offer.trip_id);
  if (!trip) return res.status(404).json({ error: "поездка не найдена" });
  if (trip.status !== "open") return res.status(400).json({ error: "поездка уже не открыта" });

  const { platformFee, driverPayout } = calculateSplit(offer.price_cents);

  const intent = await createHold({
    amountCents: offer.price_cents,
    currency: (offer.currency || "EUR").toLowerCase(),
    description: `Поездка ${trip.origin} -> ${trip.destination} (${trip.date})`,
  });

  const tx = {
    id: nanoid(10),
    trip_id: trip.id,
    offer_id: offer.id,
    passenger_id: trip.passenger_id,
    driver_id: offer.driver_id,
    amount_total_cents: offer.price_cents,
    platform_fee_cents: platformFee,
    driver_payout_cents: driverPayout,
    currency: offer.currency,
    stripe_payment_intent_id: intent.id,
    status: "held",
    created_at: now(),
    captured_at: null,
  };
  db.insert("transactions", tx);

  db.update("trips", (t) => t.id === trip.id, { status: "matched", selected_offer_id: offer.id });
  db.update("offers", (o) => o.id === offer.id, { status: "accepted" });
  db.updateMany("offers", (o) => o.trip_id === trip.id && o.id !== offer.id, { status: "rejected" });

  res.json({ transaction: tx, payment_intent: intent, mock_mode: isMockMode });
});

// ---------- PAYMENTS ----------

app.post("/api/trips/:id/complete", async (req, res) => {
  const trip = db.findOne("trips", (t) => t.id === req.params.id);
  if (!trip) return res.status(404).json({ error: "поездка не найдена" });
  const tx = db.findOne("transactions", (t) => t.trip_id === trip.id && t.status === "held");
  if (!tx) return res.status(400).json({ error: "нет заблокированного платежа для этой поездки" });

  await capturePaymentIntent(tx.stripe_payment_intent_id);

  const updatedTx = db.update("transactions", (t) => t.id === tx.id, {
    status: "captured",
    captured_at: now(),
  });
  db.update("trips", (t) => t.id === trip.id, { status: "completed" });
  db.update("users", (u) => u.id === tx.passenger_id, {
    rides_count: (db.findOne("users", (u) => u.id === tx.passenger_id)?.rides_count || 0) + 1,
  });
  db.update("users", (u) => u.id === tx.driver_id, {
    rides_count: (db.findOne("users", (u) => u.id === tx.driver_id)?.rides_count || 0) + 1,
  });

  res.json(updatedTx);
});

app.post("/api/trips/:id/cancel", async (req, res) => {
  const trip = db.findOne("trips", (t) => t.id === req.params.id);
  if (!trip) return res.status(404).json({ error: "поездка не найдена" });
  const tx = db.findOne("transactions", (t) => t.trip_id === trip.id && t.status === "held");
  if (tx) {
    await refundPaymentIntent(tx.stripe_payment_intent_id);
    db.update("transactions", (t) => t.id === tx.id, { status: "refunded" });
  }
  db.update("trips", (t) => t.id === trip.id, { status: "cancelled" });
  res.json({ ok: true });
});

// ---------- CHAT ----------

app.post("/api/trips/:id/messages", (req, res) => {
  const { sender_id, body } = req.body;
  if (!sender_id || !body) return res.status(400).json({ error: "не все поля заполнены" });
  const message = { id: nanoid(10), trip_id: req.params.id, sender_id, body, created_at: now() };
  db.insert("messages", message);
  res.json(message);
});

app.get("/api/trips/:id/messages", (req, res) => {
  res.json(
    db.find("messages", (m) => m.trip_id === req.params.id).sort((a, b) => (a.created_at > b.created_at ? 1 : -1))
  );
});

// ---------- REVIEWS / RATING ----------

app.post("/api/trips/:id/reviews", (req, res) => {
  const { author_id, target_id, rating, comment } = req.body;
  const review = {
    id: nanoid(10),
    trip_id: req.params.id,
    author_id,
    target_id,
    rating,
    comment: comment || null,
    created_at: now(),
  };
  db.insert("reviews", review);

  const allReviews = db.find("reviews", (r) => r.target_id === target_id);
  const avg = allReviews.reduce((sum, r) => sum + r.rating, 0) / allReviews.length;
  db.update("users", (u) => u.id === target_id, { rating: Math.round(avg * 10) / 10 });

  res.json(review);
});

app.get("/", (req, res) => {
  res.json({ status: "ok", mock_payments: isMockMode });
});

app.listen(PORT, () => {
  console.log(`Backend запущен: http://localhost:${PORT}`);
  console.log(
    isMockMode
      ? "Платежи в MOCK-режиме (нет STRIPE_SECRET_KEY) — холды и списания эмулируются без реального Stripe."
      : "Платежи подключены к Stripe (test/live ключ обнаружен)."
  );
});

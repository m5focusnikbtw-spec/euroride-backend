const BASE = "http://localhost:4000/api";

async function post(url, body) {
  const r = await fetch(BASE + url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  return r.json();
}
async function get(url) {
  return (await fetch(BASE + url)).json();
}

const passenger = await post("/users", { name: "Anna", role: "passenger" });
console.log("Пассажир:", passenger.name, passenger.id);

const driver = await post("/users", { name: "Jonas", role: "driver", car_make: "VW", car_model: "Passat" });
console.log("Водитель:", driver.name, driver.id);

const verified = await post(`/users/${driver.id}/verify`, { verified: true });
console.log("Верификация водителя:", verified.verified);

const trip = await post("/trips", {
  passenger_id: passenger.id,
  origin: "Tallinn",
  destination: "Berlin",
  date: "2026-07-10",
  seats: 2,
});
console.log("Поездка создана:", trip.id, trip.origin, "->", trip.destination, trip.status);

const offer = await post(`/trips/${trip.id}/offers`, {
  driver_id: driver.id,
  price_cents: 3800,
  message: "Еду в среду утром",
});
console.log("Отклик водителя:", offer.id, offer.price_cents / 100, "EUR");

const tripWithOffers = await get(`/trips/${trip.id}`);
console.log("Откликов на поездку:", tripWithOffers.offers.length);

const selectResult = await post(`/offers/${offer.id}/select`);
console.log("Выбор предложения -> холд:", selectResult.transaction.status, selectResult.payment_intent.id, "mock:", selectResult.mock_mode);

const msg = await post(`/trips/${trip.id}/messages`, { sender_id: passenger.id, body: "Можно забрать у вокзала?" });
console.log("Сообщение отправлено:", msg.body);

const completed = await post(`/trips/${trip.id}/complete`);
console.log("Поездка завершена, оплата списана:", completed.status, completed.amount_total_cents / 100, "EUR");

const review = await post(`/trips/${trip.id}/reviews`, {
  author_id: passenger.id,
  target_id: driver.id,
  rating: 5,
  comment: "Отлично!",
});
console.log("Отзыв оставлен, рейтинг:", review.rating);

const driverAfter = await get(`/users/${driver.id}`);
console.log("Новый рейтинг водителя:", driverAfter.rating, "поездок:", driverAfter.rides_count);

console.log("\n✅ Полный сценарий пройден успешно");

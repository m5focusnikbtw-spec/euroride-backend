import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, "..", "data.json");

const empty = {
  users: [],
  trips: [],
  offers: [],
  messages: [],
  reviews: [],
  transactions: [],
};

function load() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(empty, null, 2));
    return structuredClone(empty);
  }
  return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
}

let state = load();

function persist() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2));
}

function now() {
  return new Date().toISOString();
}

export const db = {
  insert(collection, row) {
    state[collection].push(row);
    persist();
    return row;
  },
  find(collection, predicate = () => true) {
    return state[collection].filter(predicate);
  },
  findOne(collection, predicate) {
    return state[collection].find(predicate) || null;
  },
  update(collection, predicate, patch) {
    let updated = null;
    state[collection] = state[collection].map((row) => {
      if (predicate(row)) {
        updated = { ...row, ...patch };
        return updated;
      }
      return row;
    });
    persist();
    return updated;
  },
  updateMany(collection, predicate, patch) {
    state[collection] = state[collection].map((row) =>
      predicate(row) ? { ...row, ...patch } : row
    );
    persist();
  },
};

export { now };

import { invoke } from "@tauri-apps/api/core";
import { KEYRING_SERVICE } from "../config";

type HttpResp = { status: number; body: number[] };

async function getJson(url: string): Promise<unknown> {
  const resp = await invoke<HttpResp>("ai_http_request", {
    url,
    method: "GET",
    headers: null,
    body: null,
  });
  if (resp.status < 200 || resp.status >= 300) {
    throw new Error(`HTTP ${resp.status}`);
  }
  return JSON.parse(new TextDecoder().decode(new Uint8Array(resp.body)));
}

export async function lookupWeather(
  city: string,
  units: "metric" | "imperial" = "metric",
): Promise<string> {
  let apiKey: string | null = null;
  try {
    apiKey = await invoke<string | null>("secrets_get", {
      service: KEYRING_SERVICE,
      account: "openweathermap",
    });
  } catch {
    // key absent from keychain
  }

  if (!apiKey) {
    return "OpenWeatherMap API key not set. Add it in **Settings → API Keys** with account name `openweathermap`. Get a free key at openweathermap.org.";
  }

  const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${apiKey}&units=${units}`;
  const data = (await getJson(url)) as {
    name: string;
    sys: { country: string };
    weather: { description: string }[];
    main: {
      temp: number;
      feels_like: number;
      temp_min: number;
      temp_max: number;
      humidity: number;
    };
    wind: { speed: number };
    visibility: number;
  };

  const unit = units === "metric" ? "°C" : "°F";
  const speedUnit = units === "metric" ? "m/s" : "mph";

  return [
    `**${data.name}, ${data.sys.country}** — ${data.weather[0]?.description ?? "unknown"}`,
    ``,
    `| | |`,
    `|---|---|`,
    `| Temperature | ${Math.round(data.main.temp)}${unit} (feels ${Math.round(data.main.feels_like)}${unit}) |`,
    `| Hi / Lo | ${Math.round(data.main.temp_max)}${unit} / ${Math.round(data.main.temp_min)}${unit} |`,
    `| Humidity | ${data.main.humidity}% |`,
    `| Wind | ${data.wind.speed} ${speedUnit} |`,
    `| Visibility | ${(data.visibility / 1000).toFixed(1)} km |`,
  ].join("\n");
}

export async function lookupExchangeRate(
  from: string,
  to: string,
  amount: number = 1,
): Promise<string> {
  const fromCode = from.toUpperCase();
  const toCode = to.toUpperCase();

  const data = (await getJson(
    `https://api.frankfurter.app/latest?from=${fromCode}&to=${toCode}`,
  )) as {
    base: string;
    date: string;
    rates: Record<string, number>;
  };

  const rate = data.rates[toCode];
  if (rate === undefined) {
    return `Currency **${toCode}** not supported. Frankfurter supports ~33 major currencies (USD, EUR, GBP, INR, JPY, AUD, CAD, CHF, CNY…).`;
  }

  const lines = [
    `**${fromCode} → ${toCode}** · as of ${data.date}`,
    ``,
    `1 ${fromCode} = ${rate.toFixed(6)} ${toCode}`,
  ];
  if (amount !== 1) {
    lines.push(`${amount} ${fromCode} = ${(amount * rate).toFixed(2)} ${toCode}`);
  }
  return lines.join("\n");
}

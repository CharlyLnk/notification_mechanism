// @ts-ignore
import { Client } from "https://deno.land/x/mqtt/deno/mod.ts";
// @ts-ignore
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import "https://deno.land/x/dotenv/load.ts";

// @ts-ignore
const SB_URI = Deno.env.get("SB_URI");
// @ts-ignore
const SB_KEY = Deno.env.get("SB_KEY");
// @ts-ignore
const BROKER_URI = Deno.env.get("BROKER_URI");
// @ts-ignore
const MQTT_TOPIC = Deno.env.get("MQTT_TOPIC");
// @ts-ignore
const MQTT_TOPIC_PUBLISH = Deno.env.get("MQTT_TOPIC_PUBLISH");

type PacketFormat = {
  H: string;
  ID: number;
  N: string;
  T: number;
  P: number;
  HR: number;
  V: number;
  HS: number;
};

// Definir umbrales
const THRESHOLDS = {
  temperature: {min: 12, max: 35}, // Umbrales de disparo de alerta de temperatura (°C)
  atm_pressure: {min: 980, max: 1050}, // Umbrales de disparo de alerta de presión atmosférica (hPa)
  rel_humidity: {min: 40, max: 70}, // Umbrales de disparo de alerta de humedad relativa (%)
  wind_speed: 10, // Ejemplo: Más de 10 m/s se dispara alerta (m/s)
  soil_moisture: {min: 50, max: 80} // Umbrales de disparo de alerta de humedad del suelo (%)
};

// Supabase connection
const supabase = createClient(SB_URI, SB_KEY);

// HiveMQ connection
const client = new Client({ url: BROKER_URI });
await client.connect();
await client.subscribe(MQTT_TOPIC);

// For decoding Uint8Array
const decoder = new TextDecoder();

client.on("message", async (topic: string, payload: Uint8Array) => {
  const dataString: string = decoder.decode(payload);
  const jsonData = JSON.parse(dataString) as PacketFormat;
  console.log(jsonData);

  // Insert data into Supabase
  const { error } = await supabase
    .from("wx_meas") // wx: abreviación de weather, y meas: abreviación de measurement
    .insert({
      created_at: new Date(Number(jsonData.H) * 1000),
      device_id: jsonData.ID,
      device_name: jsonData.N,
      temperature: jsonData.T,
      atm_pressure: jsonData.P,
      rel_humidity: jsonData.HR,
      wind_speed: jsonData.V,
      soil_moisture: jsonData.HS,
    });

    // Mensaje para consola
  let currentTime = new Date().toDateString();
  if (error) {
    console.error("Error al intentar insertar datos en Supabase: ", error);
  } else {
    console.log(
      `(${currentTime}): Registro insertado desde estación\n` +
      `Datos insertados: T:${jsonData.T}, P:${jsonData.P}, HR:${jsonData.HR}, VV:${jsonData.V}, HS:${jsonData.HS}`
    );

    // CONDICIONES DE DISPARO DE ALERTAS
    const alerts: string[] = [];
    if (jsonData.T < THRESHOLDS.temperature.min || jsonData.T > THRESHOLDS.temperature.max) {
      alerts.push(`Alerta de temperatura: ${jsonData.T}°C`);
    }
    if (jsonData.P < THRESHOLDS.atm_pressure.min || jsonData.P > THRESHOLDS.atm_pressure.max) {
      alerts.push(`Alerta de presión atmosférica: ${jsonData.P} hPa`);
    }
    if (jsonData.HR < THRESHOLDS.rel_humidity.min || jsonData.HR > THRESHOLDS.rel_humidity.max) {
      alerts.push(`Alerta de humedad relativa: ${jsonData.HR}%`);
    }
    if (jsonData.V > THRESHOLDS.wind_speed) {
      alerts.push(`Alerta de velocidad del viento: ${jsonData.V} m/s`);
    }
    if (jsonData.HS < THRESHOLDS.soil_moisture.min || jsonData.HS > THRESHOLDS.soil_moisture.max) {
      alerts.push(`Alerta de humedad del suelo: ${jsonData.HS}%`);
    }

    // FORMATEAR NOTIFICACIONES SI EXISTEN ALERTAS EN: alerts[]
    if (alerts.length > 0) {
      const alertMessage = alerts.join(", ");
      const publishPayload = `${alertMessage}`;
      try {
        await client.publish(MQTT_TOPIC_PUBLISH, new TextEncoder().encode(publishPayload));
        console.log(`Mensaje publicado en ${MQTT_TOPIC_PUBLISH}: ${publishPayload}`);
      } catch (publishError) {
        console.error("Error al intentar publicar el mensaje: ", publishError);
      }
    }
  }
});

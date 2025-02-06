// @ts-ignore
import { Client } from "https://deno.land/x/mqtt/deno/mod.ts";
// @ts-ignore
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// @ts-ignore
import twilio from "https://esm.sh/twilio@4";
import "https://deno.land/x/dotenv/load.ts";
import { applyKalmanFilterPerVariable } from "./kalman.js";

// Configuración de Twilio
// @ts-ignore
const TWILIO_SID = Deno.env.get("TWILIO_SID");
// @ts-ignore
const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN");
// @ts-ignore
const TWILIO_WHATSAPP_FROM = "whatsapp:" + Deno.env.get("TWILIO_WHATSAPP_FROM");
// @ts-ignore
const TWILIO_WHATSAPP_TO = "whatsapp:" + Deno.env.get("TWILIO_WHATSAPP_TO");

const twilioClient = twilio(TWILIO_SID, TWILIO_AUTH_TOKEN);

// Configuración de MQTT y Supabase
// @ts-ignore
const BROKER_URI = Deno.env.get("BROKER_URI");
// @ts-ignore
const MQTT_TOPIC = Deno.env.get("MQTT_TOPIC");
// @ts-ignore
const MQTT_TOPIC_PUBLISH = Deno.env.get("MQTT_TOPIC_PUBLISH");
// @ts-ignore
const SB_URI = Deno.env.get("SB_URI");
// @ts-ignore
const SB_KEY = Deno.env.get("SB_KEY");

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

// Umbrales
const THRESHOLDS = {
  temperature: { min: 12, max: 35 },
  atm_pressure: { min: 980, max: 1050 },
  rel_humidity: { min: 40, max: 70 },
  wind_speed: 10,
  soil_moisture: { min: 50, max: 80 },
};

// Conexión al cliente MQTT
const client = new Client({ url: BROKER_URI });
await client.connect();
await client.subscribe(MQTT_TOPIC);

const decoder = new TextDecoder();

client.on("message", async (topic: string, payload: Uint8Array) => {
  const dataString: string = decoder.decode(payload);
  try {
    const jsonData = JSON.parse(dataString) as PacketFormat;
    console.log(jsonData);

    // Datos originales
    const rawData = [[jsonData.T, jsonData.P, jsonData.HR, jsonData.V, jsonData.HS]];

    // Aplicar el filtro de Kalman por separado
    const filteredData = applyKalmanFilterPerVariable(rawData);

    console.log("Datos sin filtrar:", rawData.map(arr => arr.map(num => num.toFixed(2))));
    console.log("Datos filtrados:", filteredData);

    // Extraer los datos filtrados
    const temperature = filteredData[0][0];
    const atmPressure = filteredData[0][1];
    const relHumidity = filteredData[0][2];
    const windSpeed = filteredData[0][3];
    const soilMoisture = filteredData[0][4];

    const alerts: string[] = [];
    const alerts2: string[] = [];

    let alertIdCounter = 1;
    const alertRecords: { alert_id: number; device_id: number; alert_type: number; description: string }[] = [];

    // Condiciones de disparo de alertas
    if (temperature < THRESHOLDS.temperature.min || temperature > THRESHOLDS.temperature.max) {
      alerts.push(`Temperatura fuera de rango: ${temperature.toFixed(2)}°C`);
      alertRecords.push({
        alert_id: alertIdCounter++,
        device_id: jsonData.ID,
        alert_type: 1, // Define un tipo para temperatura
        description: `Temperatura fuera de rango: ${temperature.toFixed(2)}°C`,
      });
    }
    if (atmPressure < THRESHOLDS.atm_pressure.min || atmPressure > THRESHOLDS.atm_pressure.max) {
      alerts.push(`Presión atmosférica fuera de rango: ${atmPressure.toFixed(2)} hPa`);
      alertRecords.push({
        alert_id: alertIdCounter++,
        device_id: jsonData.ID,
        alert_type: 2, // Define un tipo para presión
        description: `Presión atmosférica fuera de rango: ${atmPressure.toFixed(2)} hPa`,
      });
    }
    if (relHumidity < THRESHOLDS.rel_humidity.min || relHumidity > THRESHOLDS.rel_humidity.max) {
      alerts.push(`Humedad relativa fuera de rango: ${relHumidity.toFixed(2)}%`);
      alertRecords.push({
        alert_id: alertIdCounter++,
        device_id: jsonData.ID,
        alert_type: 3, // Define un tipo para humedad
        description: `Humedad relativa fuera de rango: ${relHumidity.toFixed(2)}%`,
      });
    }
    if (windSpeed > THRESHOLDS.wind_speed) {
      alerts.push(`Velocidad del viento fuera de rango: ${windSpeed.toFixed(2)} m/s`);
      alertRecords.push({
        alert_id: alertIdCounter++,
        device_id: jsonData.ID,
        alert_type: 4, // Define un tipo para viento
        description: `Velocidad del viento fuera de rango: ${windSpeed.toFixed(2)} m/s`,
      });
    }
    if (soilMoisture < THRESHOLDS.soil_moisture.min || soilMoisture > THRESHOLDS.soil_moisture.max) {
      alerts.push(`Humedad del suelo fuera de rango: ${soilMoisture.toFixed(2)}%`);
      alertRecords.push({
        alert_id: alertIdCounter++,
        device_id: jsonData.ID,
        alert_type: 5, // Define un tipo para humedad del suelo
        description: `Humedad del suelo fuera de rango: ${soilMoisture.toFixed(2)}%`,
      });
    }

    // Supabase connection
    const supabase = createClient(SB_URI, SB_KEY);

    // Insertar alertas en la tabla "alerta"
    if (alertRecords.length > 0) {
      try {
        const { error } = await supabase
          .from("alerta")
          .insert(alertRecords.map(alert => ({ ...alert, created_at: new Date().toISOString() })));

        if (error) {
          console.error("Error al insertar alertas en Supabase:", error);
        } else {
          console.log("Alertas insertadas en Supabase correctamente.");
        }
      } catch (err) {
        console.error("Error al insertar alertas en Supabase:", err);
      }
    }

    // Si hay alertas, envía un mensaje de WhatsApp
    if (alerts.length > 0) {
      const alertMessage = alerts.join("\n");
      console.log("Enviando alerta por WhatsApp:\n", alertMessage, "\n");

      try {
        await twilioClient.messages.create({
          from: TWILIO_WHATSAPP_FROM,
          to: TWILIO_WHATSAPP_TO,
          body: `⚠️ Alerta desde IoTColimex:\n${alertMessage}`,
        });
        console.log("Mensaje enviado por WhatsApp.");
      } catch (error) {
        console.error("Error al enviar mensaje de WhatsApp:", error);
      }
    }

    // FORMATEAR NOTIFICACIONES SI EXISTEN ALERTAS EN: alerts[]
    if (alerts2.length > 0) {
      const alertMessage = alerts.join(", ");
      const publishPayload = `${alertMessage}`;
      try {
        await client.publish(MQTT_TOPIC_PUBLISH, new TextEncoder().encode(publishPayload));
        console.log(`Mensaje publicado en ${MQTT_TOPIC_PUBLISH}: ${publishPayload}`);
      } catch (publishError) {
        console.error("Error al intentar publicar el mensaje: ", publishError);
      }
    }

    // Insertar datos filtrados en Supabase
    try {
      const { error } = await supabase
        .from("wx_meas")
        .insert({
          created_at: new Date(Number(jsonData.H) * 1000),
          device_id: jsonData.ID,
          device_name: jsonData.N,
          temperature: temperature,
          atm_pressure: atmPressure,
          rel_humidity: relHumidity,
          wind_speed: windSpeed,
          soil_moisture: soilMoisture,
        });

      if (error) {
        console.error("Error al insertar en Supabase:", error);
      } else {
        console.log("Datos filtrados insertados en Supabase correctamente.");
      }
    } catch (e) {
      console.error("Error al analizar la cadena JSON: ", e);
      console.error("Cadena JSON: ", dataString);
    }
  } catch (error) {
    console.error("Error en el bloque try principal: ", error);
  }
});

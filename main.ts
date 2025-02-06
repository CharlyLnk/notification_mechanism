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
const supabase = createClient(Deno.env.get("SB_URI"), Deno.env.get("SB_KEY"));

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

let alertIdCounter = 0;

client.on("message", async (topic: string, payload: Uint8Array) => {
  const dataString: string = decoder.decode(payload);
  try {
    const jsonData = JSON.parse(dataString) as PacketFormat;
    console.log("Datos recibidos:", jsonData);

    // Aplicar filtro de Kalman por separado a cada variable
    const filteredData = applyKalmanFilterPerVariable(jsonData);


    //Verificar en consola si los datos han sido filtrados correctamente
    console.log("Datos sin filtrar: ", {
      temperature: jsonData.T.toFixed(2),
      atmPressure: jsonData.P.toFixed(2),
      relHumidity: jsonData.HR.toFixed(2),
      windSpeed: jsonData.V.toFixed(2),
      soilMoisture: jsonData.HS.toFixed(2),
    });

    console.log("Datos filtrados: ", {
      temperature: filteredData.temperature.toFixed(2),
      atmPressure: filteredData.atmPressure.toFixed(2),
      relHumidity: filteredData.relHumidity.toFixed(2),
      windSpeed: filteredData.windSpeed.toFixed(2),
      soilMoisture: filteredData.soilMoisture.toFixed(2),
    });

    // Extraer valores filtrados
    const { temperature, atmPressure, relHumidity, windSpeed, soilMoisture } = filteredData;

    const alerts: string[] = [];
    const alerts2: string[] = [];
    const alertRecords: { alert_id: number; device_id: number; alert_type: number; description: string }[] = [];

    // Verificar fallas de comunicación (NaN en los datos)
    if (isNaN(temperature) || isNaN(atmPressure) || isNaN(relHumidity) || isNaN(windSpeed) || isNaN(soilMoisture)) {
      alertRecords.push({
        alert_id: 3, // Falla de comunicación
        device_id: jsonData.ID,
        alert_type: 0, // Tipo general de falla
        description: "Falla de comunicación con el sensor",
      });
    }

    // Verificar valores atípicos (disparos grandes en comparación con valores previos)
    const outlierThreshold = 20; // Define el umbral para detectar atípicos
    const outliers: string[] = [];

    if (Math.abs(jsonData.T - temperature) > outlierThreshold) {
      outliers.push(`Temperatura (${temperature.toFixed(2)}°C)`);
    }
    if (Math.abs(jsonData.P - atmPressure) > outlierThreshold) {
      outliers.push(`Presión Atmosférica: (${atmPressure.toFixed(2)} hPa)`);
    }
    if (Math.abs(jsonData.HR - relHumidity) > outlierThreshold) {
      outliers.push(`Humedad Relativa: (${relHumidity.toFixed(2)}%)`);
    }
    if (Math.abs(jsonData.V - windSpeed) > outlierThreshold) {
      outliers.push(`Velocidad del Viento: (${windSpeed.toFixed(2)} m/s)`);
    }
    if (Math.abs(jsonData.HS - soilMoisture) > outlierThreshold) {
      outliers.push(`Humedad del Suelo: (${soilMoisture.toFixed(2)}%)`);
    }

    if (outliers.length > 0) {
      alertRecords.push({
        alert_id: 1, // Valor atípico
        device_id: jsonData.ID,
        alert_type: 0, // Tipo general de atípico
        description: "Valor atípico detectado en: " + outliers.join(", "),
      });
    }

    // Verificar valores fuera de rango
    if (temperature < THRESHOLDS.temperature.min || temperature > THRESHOLDS.temperature.max) {
      alertRecords.push({
        alert_id: 2, // Valor fuera de rango
        device_id: jsonData.ID,
        alert_type: 1, // Categoría: Temperatura
        description: temperature < THRESHOLDS.temperature.min
          ? `Temperatura por debajo del rango permitido: ${temperature.toFixed(2)}°C`
          : `Temperatura por encima del rango permitido: ${temperature.toFixed(2)}°C`,
      });
    }
    if (atmPressure < THRESHOLDS.atm_pressure.min || atmPressure > THRESHOLDS.atm_pressure.max) {
      alertRecords.push({
        alert_id: 2, // Valor fuera de rango
        device_id: jsonData.ID,
        alert_type: 2, // Categoría: Presión Atmosférica
        description: atmPressure < THRESHOLDS.atm_pressure.min
          ? `Presión atmosférica por debajo del rango permitido: ${atmPressure.toFixed(2)} hPa`
          : `Presión atmosférica por encima del rango permitido: ${atmPressure.toFixed(2)} hPa`,
      });
    }
    if (relHumidity < THRESHOLDS.rel_humidity.min || relHumidity > THRESHOLDS.rel_humidity.max) {
      alertRecords.push({
        alert_id: 2, // Valor fuera de rango
        device_id: jsonData.ID,
        alert_type: 3, // Categoría: Humedad Relativa
        description: relHumidity < THRESHOLDS.rel_humidity.min
          ? `Humedad relativa por debajo del rango permitido: ${relHumidity.toFixed(2)}%`
          : `Humedad relativa por encima del rango permitido: ${relHumidity.toFixed(2)}%`,
      });
    }
    if (windSpeed > THRESHOLDS.wind_speed) {
      alertRecords.push({
        alert_id: 2, // Valor fuera de rango
        device_id: jsonData.ID,
        alert_type: 4, // Categoría: Velocidad del Viento
        description: `Velocidad del viento por encima del rango permitido: ${windSpeed.toFixed(2)} m/s`,
      });
    }
    if (soilMoisture < THRESHOLDS.soil_moisture.min || soilMoisture > THRESHOLDS.soil_moisture.max) {
      alertRecords.push({
        alert_id: 2, // Valor fuera de rango
        device_id: jsonData.ID,
        alert_type: 5, // Categoría: Humedad del Suelo
        description: soilMoisture < THRESHOLDS.soil_moisture.min
          ? `Humedad del suelo por debajo del rango permitido: ${soilMoisture.toFixed(2)}%`
          : `Humedad del suelo por encima del rango permitido: ${soilMoisture.toFixed(2)}%`,
      });
    }

    // FORMATEAR NOTIFICACIONES SI EXISTEN ALERTAS EN alertRecords
    if (alertRecords.length > 0) {
      // Crear un mapa para obtener etiquetas descriptivas del tipo de alerta
      const getAlertTypeLabel = (alertType: number): string => {
        switch (alertType) {
          case 1:
            return "Temperatura";
          case 2:
            return "Presión atmosférica";
          case 3:
            return "Humedad relativa";
          case 4:
            return "Velocidad del viento";
          case 5:
            return "Humedad del suelo";
          default:
            return "Desconocido";
        }
      };

      // Crear un mensaje formateado con los detalles de las alertas
      const formattedAlerts = alertRecords.map((alert) => ({
        alert_id: alert.alert_id,
        description: `Variable: ${getAlertTypeLabel(alert.alert_type)},\n Descripción: ${alert.description}`
      }));

      // Publicar en el broker MQTT
      try {
        await client.publish(
          MQTT_TOPIC_PUBLISH,
          new TextEncoder().encode(JSON.stringify(formattedAlerts))
        );
        console.log(`Mensaje publicado en ${MQTT_TOPIC_PUBLISH}:`, formattedAlerts);
      } catch (publishError) {
        console.error("Error al intentar publicar el mensaje: ", publishError);
      }

      // Enviar las alertas por WhatsApp
      try {
        await twilioClient.messages.create({
          from: TWILIO_WHATSAPP_FROM,
          to: TWILIO_WHATSAPP_TO,
          body: `⚠️ Alerta desde IoTColimex:\n${formattedAlerts.map(a => a.description).join("\n")}`,
        });
        console.log("Mensaje enviado por WhatsApp.");
      } catch (error) {
        console.error("Error al enviar mensaje de WhatsApp:", error);
      }
    }

    // Insertar alertas en Supabase
    try {
      const { error } = await supabase
        .from("alerta")
        .insert(
          alertRecords.map((alert) => ({
            ...alert,
            created_at: new Date().toISOString(), // Usar formato ISO con la zona horaria actual
          }))
        );

      if (error) {
        console.error("Error al insertar alertas en Supabase:", error);
      } else {
        console.log("Alertas insertadas en Supabase correctamente.");
      }
    } catch (err) {
      console.error("Error al insertar alertas en Supabase:", err);
      }
    } catch (error) {
      console.error("Error al procesar el mensaje:", error);
    }
  });
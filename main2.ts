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

  let currentTime = new Date().toDateString();
  if (error) {
    console.error("Error al intentar insertar datos en Supabase: ", error);
  } else {
    console.log(
      `(${currentTime}): Registro insertado desde estación\n` +
      `Datos insertados: T:${jsonData.T}, P:${jsonData.P}, HR:${jsonData.HR}, VV:${jsonData.V}, HS:${jsonData.HS}`
    );

    // Publish data to MQTT_TOPIC_PUBLISH
    try {
      const publishPayload = JSON.stringify({
        timestamp: new Date(Number(jsonData.H) * 1000).toISOString(),
        temperature: jsonData.T,
        atm_pressure: jsonData.P,
        rel_humidity: jsonData.HR,
        wind_speed: jsonData.V,
        soil_moisture: jsonData.HS,
        device_id: jsonData.ID,
        device_name: jsonData.N,
      });

      await client.publish(MQTT_TOPIC_PUBLISH, new TextEncoder().encode(publishPayload));
      console.log(
        `Mensaje publicado en ${MQTT_TOPIC_PUBLISH}: ${publishPayload}`
      );
    } catch (publishError) {
      console.error("Error al intentar publicar el mensaje: ", publishError);
    }
  }
});

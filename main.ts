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

  const { error } = await supabase
    .from("wx_meas") //wx:abreviación de weather, y meas: abreviación de measurement
    .insert({
      created_at: new Date(Number(jsonData.H) * 1000),
      temperature: jsonData.T,
      atm_pressure: jsonData.P,
      rel_humidity: jsonData.HR,
      wind_speed: jsonData.V,
      soil_moisture: jsonData.HS,   
      device_id: jsonData.ID,         
      device_name: jsonData.N,
    });

  // For printing the date in the console. Maybe we can use something better
  // in the future like logging to a file.
  let currentTime = new Date().toDateString();
  error
    ? console.error("Error al internar insertar datos en Supbase: ", error)
    : console.log(
        `(${currentTime}): Registro insertado desde estación\n` +
        `Datos insertados: T:${jsonData.T}, P:${jsonData.P}, HR:${jsonData.HR}, VV:${jsonData.V}, HS:${jsonData.HS}`
      );
});

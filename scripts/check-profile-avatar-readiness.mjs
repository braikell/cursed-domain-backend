import dotenv from "dotenv";
import {createClient} from "@supabase/supabase-js";
import {readFileSync,writeFileSync,mkdirSync} from "node:fs";
import {resolve} from "node:path";
dotenv.config({quiet:true});
const root=resolve(import.meta.dirname,"../../..");
const url=process.env.SUPABASE_URL;
const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!url||!key)throw new Error("Configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. This probe is read-only.");
const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
const [profile,cards,identity,cosmetics]=await Promise.all([
 client.from("profiles").select("id,avatar_card_id,updated_at").limit(0),
 client.from("user_cards").select("id,user_id,character_key,character_id,card_type,variant,definition_rarity").limit(0),
 client.rpc("get_player_profile_avatar_v1",{p_user_id:"00000000-0000-0000-0000-000000000000"}),
 client.rpc("get_player_cosmetics_v1",{p_user_id:"00000000-0000-0000-0000-000000000000"}),
]);
const report={readOnly:true,checkedAt:new Date().toISOString(),database:{profileColumns:!profile.error,cardColumns:!cards.error,identityRpcReady:!identity.error,identityRpcErrorCode:identity.error?.code??null,cosmeticsRpcReady:!cosmetics.error},backend:{},ready:false};
const config=readFileSync(resolve(root,"config/backend/backend_config.tres"),"utf8");
const api=process.env.GODOT_BACKEND_READINESS_URL??/backend_api_base_url\s*=\s*"([^"]+)"/.exec(config)?.[1];
if(api){
 const responses=await Promise.all(["/health","/api/godot/profile/avatar"].map(async path=>{
  try{const response=await fetch(api+path,{signal:AbortSignal.timeout(20000)});return {status:response.status,body:await response.json().catch(()=>null)};}
  catch{return {status:0,body:null};}
 }));
 const routePresent=responses[1].status===0?null:[400,401].includes(responses[1].status)&&responses[1].body?.module==="profile_avatar_status";
 report.backend={healthStatus:responses[0].status,unauthenticatedProfileAvatarStatus:responses[1].status,routePresent};
 report.ready=report.database.profileColumns&&report.database.cardColumns&&report.database.identityRpcReady&&report.database.cosmeticsRpcReady&&responses[0].status===200&&routePresent;
}
mkdirSync(resolve(root,"tmp/profile_avatar_qa"),{recursive:true});
writeFileSync(resolve(root,"tmp/profile_avatar_qa/deployment_readiness.json"),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
process.exitCode=report.ready?0:1;

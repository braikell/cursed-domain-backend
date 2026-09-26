import { getIncursionDeclaredDurationThroughWave } from "./balance.js";
import type { CompleteIncursionInput, GodotAuthedRequestContext, StartIncursionInput } from "../../contracts.js";
import { HttpModuleError } from "../../errors.js";
import { createServiceSupabaseClient } from "../../supabase.js";
import { calculateIncursionRewards, INCURSION_ENTRY_COSTS, INCURSION_MAX_WAVES, INCURSION_SESSION_TTL_SECONDS, INCURSION_WAVE_DURATION_SECONDS } from "./balance.js";
export const INCURSION_COMPLETION_GRACE_SECONDS = 86400;
const MAX_POSSIBLE_KILLS_PER_WAVE = 56;
export interface IncursionSessionRow {
    id: string;
    user_id: string;
    mode: string;
    started_at: string;
    expires_at: string;
    consumed_at: string | null;
    min_duration_seconds: number;
    wave_limit: number | null;
    incursion_completion: Record<string, unknown> | null;
}
function assertRequestId(id: string): void {
    if (!/^[a-zA-Z0-9_-]{8,80}$/.test(id))
        throw new HttpModuleError(400, "invalid_request_id", "incursion_entry", "Identificador de operacion invalido.");
}
function rpcFailure(error: {
    code?: string;
    message: string;
}, module: "incursion_entry" | "incursion_complete"): never {
    const code = error.message.toLowerCase();
    if (error.code === "PGRST202" || error.code === "42703" || code.includes("invalid_incursion_config")) {
        throw new HttpModuleError(503, "incursion_configuration_unavailable", module, "Incursiones requiere actualizar su configuracion del servidor. No se ha realizado un nuevo cobro.");
    }
    const messages: Record<string, string> = {
        insufficient_funds: "No tienes recursos suficientes.",
        incursion_session_active: "Ya existe una incursion activa. No se realizo otro cobro.",
        incursion_session_expired: "La sesion de incursion ha vencido.",
        incursion_session_consumed: "Esta sesion ya fue cerrada. Conserva el resultado pendiente para revision.",
        request_id_reused: "El identificador pertenece a otra operacion.",
        incursion_session_not_found: "No se encontro la sesion de incursion.",
        invalid_incursion_result: "El resultado no coincide con las reglas de la incursion.",
    };
    const known = Object.keys(messages).find(key => code.includes(key));
    if (known)
        throw new HttpModuleError(known === "insufficient_funds" ? 400 : 409, known, module, messages[known]);
    throw new HttpModuleError(503, "incursion_retry_required", module, "No se pudo confirmar la operacion. Reintenta sin cambiar su identificador.");
}
export async function startIncursionDedicated(context: GodotAuthedRequestContext, input: StartIncursionInput): Promise<unknown> {
    assertRequestId(input.requestId);
    const { data, error } = await createServiceSupabaseClient().rpc("start_incursion_session_v2", {
        target_user_id: context.userId, target_request_id: input.requestId, target_currency: input.currency,
        target_cost: INCURSION_ENTRY_COSTS[input.currency], session_ttl_seconds: INCURSION_SESSION_TTL_SECONDS, target_wave_limit: INCURSION_MAX_WAVES,
    });
    if (error)
        rpcFailure(error, "incursion_entry");
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || typeof row.session_id !== "string")
        throw new HttpModuleError(503, "incursion_retry_required", "incursion_entry", "No se pudo confirmar la entrada. Reintenta la misma operacion.");
    return { ok: true, data: { incursionSessionId: row.session_id, startedAt: row.started_at, expiresAt: row.expires_at, currency: row.currency, cost: Number(row.cost), save: { gold: Number(row.gold), gems: Number(row.gems) }, replay: row.replay === true } };
}
export async function completeIncursionDedicated(context: GodotAuthedRequestContext, input: CompleteIncursionInput): Promise<unknown> {
    assertRequestId(input.requestId);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.incursionSessionId))
        throw new HttpModuleError(400, "invalid_incursion_session", "incursion_complete", "Sesion invalida.");
    const supabase = createServiceSupabaseClient();
    const { data: session, error: readError } = await supabase.from("battle_sessions").select("id,user_id,mode,started_at,expires_at,consumed_at,min_duration_seconds,wave_limit,incursion_completion").eq("id", input.incursionSessionId).eq("user_id", context.userId).maybeSingle<IncursionSessionRow>();
    if (readError)
        rpcFailure(readError, "incursion_complete");
    if (!session)
        throw new HttpModuleError(404, "incursion_session_not_found", "incursion_complete", "Sesion no encontrada.");
    // A committed result is replayed by SQL even after expiry; the session is the idempotency key.
    if (!session.incursion_completion) {
        validateIncursionSession(session, input.waveReached, input.kills, input.survivalTime, input.resultType === "abandoned", input.rulesVersion ?? 1);
        if ((input.resultType === "victory" && input.waveReached !== INCURSION_MAX_WAVES) || (input.resultType === "extraction" && input.waveReached < (input.rulesVersion === 2 ? 3 : 4)))
            throw new HttpModuleError(400, "invalid_incursion_result", "incursion_complete", "Resultado incompatible con la oleada.");
    }
    const resultType = input.resultType ?? "defeat";
    const rewards = calculateIncursionRewards(input.waveReached, resultType);
    const { data, error } = await supabase.rpc(input.rulesVersion === 2 ? "complete_incursion_session_v3" : "complete_incursion_session_v2", {
        target_user_id: context.userId, target_session_id: input.incursionSessionId, target_request_id: input.requestId,
        target_wave: input.waveReached, target_kills: input.kills, target_survival: input.survivalTime ?? 0, target_result: resultType,
        reward_gold: rewards.gold, reward_gems: rewards.gems, reward_xp: rewards.xp,
    });
    if (error)
        rpcFailure(error, "incursion_complete");
    if (!data || data.ok !== true || !data.rewards)
        throw new HttpModuleError(503, "incursion_retry_required", "incursion_complete", "Confirmacion de recompensa incompleta; reintenta.");
    return data;
}
export function validateIncursionSession(session: IncursionSessionRow, waveReached: number, kills: number, survivalTime: number | undefined, abandoned = false, rulesVersion: 1 | 2 = 1): void {
    if (!Number.isInteger(waveReached) || !Number.isInteger(kills) || (survivalTime !== undefined && !Number.isFinite(survivalTime)))
        throw new HttpModuleError(400, "invalid_incursion_result", "incursion_complete", "Resultado invalido.");
    if (session.mode !== "incursion") {
        throw new HttpModuleError(400, "incursion_session_mode_mismatch", "incursion_complete", "Sesion de incursión invalida.");
    }
    if (session.consumed_at != null) {
        throw new HttpModuleError(409, "incursion_session_consumed", "incursion_complete", "Esta incursión ya fue cerrada.");
    }
    const now = Date.now();
    const startedAt = new Date(session.started_at).getTime();
    const expiresAt = new Date(session.expires_at).getTime();
    const elapsed = Math.max(0, (now - startedAt) / 1000);
    if (!Number.isFinite(startedAt) || !Number.isFinite(expiresAt) || (!abandoned && now >= expiresAt + INCURSION_COMPLETION_GRACE_SECONDS * 1000)) {
        throw new HttpModuleError(409, "incursion_session_expired", "incursion_complete", "La sesión de incursión expiró.");
    }
    if (!abandoned && elapsed + 0.75 < Math.max(0, session.min_duration_seconds)) {
        throw new HttpModuleError(409, "incursion_duration_too_short", "incursion_complete", "La incursión terminó demasiado rápido.");
    }
    if (Number.isFinite(survivalTime) && (Number(survivalTime) < 0 || Number(survivalTime) > Math.min(elapsed, (expiresAt - startedAt) / 1000) + 10)) {
        throw new HttpModuleError(400, "invalid_survival_time", "incursion_complete", "Tiempo de supervivencia inválido.");
    }
    if (rulesVersion === 2) {
        const survival = survivalTime ?? -1;
        if (waveReached < 0 || waveReached > Math.min(session.wave_limit ?? INCURSION_MAX_WAVES, INCURSION_MAX_WAVES) || survival < 0 || survival + 0.1 < getIncursionDeclaredDurationThroughWave(waveReached))
            throw new HttpModuleError(400, "invalid_wave_progress", "incursion_complete", "Oleadas completadas incompatibles con el tiempo jugado.");
        // Conservative envelope: replenishment, initial cap and summon bursts. Not authoritative anti-cheat.
        if (kills < 0 || kills > 54 + Math.floor(survival * 64))
            throw new HttpModuleError(400, "invalid_kill_count", "incursion_complete", "Cantidad de bajas invalida.");
        return;
    }
    const maxWaveByTime = Math.min(INCURSION_MAX_WAVES, Math.max(1, Math.floor(Math.max(0, elapsed - 3) / INCURSION_WAVE_DURATION_SECONDS) + 1));
    const maxWave = Math.min(session.wave_limit ?? INCURSION_MAX_WAVES, maxWaveByTime);
    if (waveReached < 0 || waveReached > maxWave) {
        throw new HttpModuleError(400, "invalid_wave_progress", "incursion_complete", "La oleada no coincide con el tiempo de la sesión.");
    }
    const maxKills = (Math.max(0, waveReached) + 1) * MAX_POSSIBLE_KILLS_PER_WAVE;
    if (kills < 0 || kills > maxKills) {
        throw new HttpModuleError(400, "invalid_kill_count", "incursion_complete", "La cantidad de kills no es válida.");
    }
}


import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";


async function sha256(message: string) {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}


const rateLimits = new Map<string, { count: number, resetAt: number }>();

Deno.serve(async (req) => {
  console.log(`[INCOMING REQUEST] Method: ${req.method}, URL: ${req.url}`);
  

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };

  if (req.method === 'OPTIONS') {
    console.log("[OPTIONS] Returning CORS headers");
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    console.log(`[AUTH HEADER] Present: ${!!authHeader}`);
    const { video_url, module_name, device_id } = await req.json();

    if (!video_url || !module_name || !device_id) {
      return new Response(JSON.stringify({ error: "Missing parameters" }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }


    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    
    const supabase = createClient(supabaseUrl, supabaseAnonKey);


    console.log(`[SUPABASE CLIENT] Fetching user...`);
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.log(`[UNAUTHORIZED] Missing or invalid Authorization header.`);
      return new Response(JSON.stringify({ error: "Missing Authorization header" }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    
    const jwt = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabase.auth.getUser(jwt);
    
    if (userError) {
       console.error(`[AUTH ERROR] ${userError.message}`, userError);
    }

    if (userError || !user) {
      console.log(`[UNAUTHORIZED] No valid user found. Returning 401.`);
      return new Response(JSON.stringify({ error: "Unauthorized", details: userError }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    
    console.log(`[USER AUTHENTICATED] User ID: ${user.id}`);


    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);


    const { data: activeSession, error: sessionError } = await supabaseAdmin
      .from('active_sessions')
      .select('device_id, initial_ip, last_ip')
      .eq('user_id', user.id)
      .eq('active', true)
      .single();

    if (sessionError || !activeSession || activeSession.device_id !== device_id) {
      console.log(`[SESSION ERROR] Invalid session or device mismatch for user: ${user.id}`);
      return new Response(JSON.stringify({ error: "Oturum sonlandırıldı veya cihaz uyuşmazlığı" }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const clientIp = req.headers.get('x-forwarded-for') || 'unknown';
    

    if (activeSession.initial_ip !== clientIp && activeSession.last_ip !== clientIp) {
      supabaseAdmin.from('security_alerts').insert({
        user_id: user.id,
        user_email: user.email,
        alert_type: 'video_ip_change',
        details: `IP changed during video load to ${clientIp}`
      }).then();
    }


    const now = Date.now();
    const userLimits = rateLimits.get(user.id);
    if (userLimits) {
      if (now > userLimits.resetAt) {
        rateLimits.set(user.id, { count: 1, resetAt: now + 60000 });
      } else {
        if (userLimits.count >= 10) {
          return new Response(JSON.stringify({ error: "Rate limit exceeded (Max 10 requests per minute)" }), { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        userLimits.count++;
      }
    } else {
      rateLimits.set(user.id, { count: 1, resetAt: now + 60000 });
    }


    console.log(`[ENTITLEMENT] Checking profile for user: ${user.id}`);
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('allowed_modules')
      .eq('id', user.id)
      .single();

    if (profileError || !profile) {
      console.log(`[ENTITLEMENT ERROR] Profile not found:`, profileError);
      return new Response(JSON.stringify({ error: "Profile not found" }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const allowed = profile.allowed_modules || [];
    if (!allowed.includes('hepsi') && !allowed.includes(module_name)) {
      console.log(`[ENTITLEMENT ERROR] User not allowed to view module: ${module_name}`);
      return new Response(JSON.stringify({ error: "Entitlement check failed: No access to this module" }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }


    const match = video_url.match(/(?:play|embed)\/([^/]+)\/([^/?]+)/);
    if (!match) {
      console.log(`[URL ERROR] Invalid URL: ${video_url}`);
      return new Response(JSON.stringify({ error: "Invalid video URL format" }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const libraryId = match[1];
    const videoId = match[2];
    
    console.log(`[BUNNY KEY] Fetching secret...`);
    const { data: setting, error: settingError } = await supabaseAdmin
      .from('app_settings')
      .select('setting_value')
      .eq('setting_key', 'bunny_token_key')
      .single();

    if (settingError || !setting) {
      return new Response(JSON.stringify({ error: "Bunny key configuration missing in database" }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    
    const securityKey = setting.setting_value;


    const expires = Math.floor(Date.now() / 1000) + 60; // 60 sn TTL
    const tokenStr = `${securityKey}${videoId}${expires}`;
    const token = await sha256(tokenStr);

    const signedUrl = `https://iframe.mediadelivery.net/embed/${libraryId}/${videoId}?token=${token}&expires=${expires}`;

    return new Response(
      JSON.stringify({
        signed_url: signedUrl,
        watermark_text: user.email,
        timestamp: Date.now()
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});

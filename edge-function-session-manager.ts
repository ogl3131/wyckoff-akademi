import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

Deno.serve(async (req) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: "Missing Authorization header" }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    
    const { action, device_id } = await req.json();
    if (!action || !device_id) {
      return new Response(JSON.stringify({ error: "Missing action or device_id" }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    

    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey);
    const jwt = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabaseUser.auth.getUser(jwt);
    
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }


    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
    const clientIp = req.headers.get('x-forwarded-for') || 'unknown';

    if (action === 'create') {

      await supabaseAdmin
        .from('active_sessions')
        .update({ active: false })
        .eq('user_id', user.id);


      const { data: newSession, error: createError } = await supabaseAdmin
        .from('active_sessions')
        .insert({
          user_id: user.id,
          device_id: device_id,
          initial_ip: clientIp,
          last_ip: clientIp,
          active: true
        })
        .select()
        .single();

      if (createError) throw createError;
      return new Response(JSON.stringify({ success: true, session: newSession }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    } else if (action === 'refresh') {

      const { data: activeSession, error: fetchError } = await supabaseAdmin
        .from('active_sessions')
        .select('*')
        .eq('user_id', user.id)
        .eq('active', true)
        .single();


      if (fetchError || !activeSession || activeSession.device_id !== device_id) {
        return new Response(JSON.stringify({ error: "Session terminated or device mismatch" }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }


      if (activeSession.initial_ip !== clientIp && activeSession.last_ip !== clientIp) {

        supabaseAdmin.from('security_alerts').insert({
          user_id: user.id,
          user_email: user.email,
          alert_type: 'ip_change',
          details: `IP changed to ${clientIp}`
        }).then();
      }


      await supabaseAdmin
        .from('active_sessions')
        .update({ last_seen: new Date().toISOString(), last_ip: clientIp })
        .eq('session_id', activeSession.session_id);

      return new Response(JSON.stringify({ success: true }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ error: "Invalid action" }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});

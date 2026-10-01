export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const data = await request.json();

    const name = (data.name || '').toString().slice(0, 100);
    const phone = (data.phone || '').toString().slice(0, 30);

    if (!name || !phone) {
      return new Response(JSON.stringify({ ok: false, error: 'Name and phone required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Store in KV if binding exists
    const timestamp = new Date().toISOString();
    const recordId = 'chat_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    if (env.CHAT_REQUESTS) {
      await env.CHAT_REQUESTS.put(recordId, JSON.stringify({ name, phone, timestamp }));
    }

    // Send email notification via Resend if configured
    const subject = 'Live chat request from ' + name;
    const body = 'A visitor requested LIVE CHAT on unitedtraffictickets.com\n\n'
      + 'Name: ' + name + '\n'
      + 'Phone: ' + phone + '\n'
      + 'Time: ' + timestamp + '\n';

    if (env.RESEND_API_KEY) {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + env.RESEND_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: 'United Traffic Tickets <noreply@unitedtraffictickets.com>',
          to: 'unitedtraffictickets@gmail.com',
          subject: subject,
          text: body
        })
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: 'Server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

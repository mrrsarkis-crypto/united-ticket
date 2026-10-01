// POST /api/live-chat-request — notify Sarkis when a visitor requests live chat
import { resendSend } from './_shared.js';

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const name = (body.name || '').toString().slice(0, 100);
    const phone = (body.phone || '').toString().slice(0, 30);
    const page = (body.page || '').toString().slice(0, 300);

    const subject = 'Live chat request' + (name ? ' from ' + name : '');
    const text =
      'A visitor requested LIVE CHAT on unitedtraffictickets.com

' +
      'Name: ' + (name || '—') + '
' +
      'Phone: ' + (phone || '—') + '
' +
      'Page: ' + (page || '—') + '
' +
      'Time: ' + new Date().toISOString() + '

' +
      'Reply to them ASAP — they are waiting in the chat widget.';

    try {
      await resendSend(env, {
        to: 'unitedtraffictickets@gmail.com',
        subject, text,
        from: 'chat@unitedtraffictickets.com',
      });
    } catch (e) { console.log('live-chat email failed', e); }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }
}

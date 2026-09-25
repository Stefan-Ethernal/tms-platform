export interface LinkMailVars {
  firstName: string;
  url: string;
  expiresAt: string;
}
export interface MailTemplateVars {
  invite: LinkMailVars;
  'password-reset': LinkMailVars;
  'mfa-reset': LinkMailVars;
}
export type MailTemplateId = keyof MailTemplateVars;
export type MailLocale = 'en';

interface TemplateText {
  subject: string;
  intro: (v: LinkMailVars) => string[];
  action: string;
}

/** The only bundle for now (UI language decision: en); keys are template ids. */
const EN: Record<MailTemplateId, TemplateText> = {
  invite: {
    subject: 'Your TMS account invitation',
    intro: (v) => [
      `Hello ${v.firstName},`,
      'An administrator created a TMS account for you.',
      'Open the link below to set your password and connect your authenticator app.',
      `The link can be used once and expires at ${v.expiresAt} (UTC).`,
    ],
    action: 'Accept the invitation',
  },
  'password-reset': {
    subject: 'Reset your TMS password',
    intro: (v) => [
      `Hello ${v.firstName},`,
      'Someone asked to reset the password of your TMS account.',
      'Open the link below to choose a new password. You will still need your authenticator app to sign in.',
      `The link can be used once and expires at ${v.expiresAt} (UTC).`,
    ],
    action: 'Choose a new password',
  },
  'mfa-reset': {
    subject: 'Set up your TMS authenticator again',
    intro: (v) => [
      `Hello ${v.firstName},`,
      'An administrator reset the two-factor authentication of your TMS account.',
      'Open the link below, confirm your password and connect your authenticator app again.',
      `The link can be used once and expires at ${v.expiresAt} (UTC).`,
    ],
    action: 'Set up the authenticator',
  },
};

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );

export function renderMail<K extends MailTemplateId>(
  id: K,
  _locale: MailLocale,
  vars: MailTemplateVars[K],
) {
  const t = EN[id];
  const lines = t.intro(vars);
  const footer = 'If you did not expect this email, you can ignore it.';
  return {
    subject: t.subject,
    text: [...lines, '', vars.url, '', footer].join('\n'),
    html: `${lines.map((l) => `<p>${escapeHtml(l)}</p>`).join('')}<p><a href="${escapeHtml(vars.url)}">${escapeHtml(t.action)}</a></p><p>${escapeHtml(footer)}</p>`,
  };
}

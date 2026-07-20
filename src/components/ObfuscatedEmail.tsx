"use client";

import { useEffect, useState } from "react";

// Почта собирается на клиенте из частей: в SSR-разметке и HTML-исходнике
// целого адреса нет, поэтому простые скраперы e-mail не находят. Живой
// посетитель видит обычную mailto-ссылку после гидратации.
const USER = "hello";
const DOMAIN_PARTS = ["jumboinjapan", "com"];

export function ObfuscatedEmail({ className }: { className?: string }) {
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    setEmail(`${USER}@${DOMAIN_PARTS.join(".")}`);
  }, []);

  if (!email) return <span className={className}>&nbsp;</span>;

  return (
    <a href={`mailto:${email}`} className={className}>
      {email}
    </a>
  );
}

"use client";

import { useState, useEffect } from "react";

const sf = "'Outfit', -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Helvetica Neue', Arial, sans-serif";

interface CountdownProps {
  deadline: number;
  onExpired?: () => void;
  size?: "sm" | "md";
}

export default function Countdown({ deadline, onExpired, size = "md" }: CountdownProps) {
  const [timeLeft, setTimeLeft] = useState(getTimeLeft(deadline));

  useEffect(() => {
    const timer = setInterval(() => {
      const tl = getTimeLeft(deadline);
      setTimeLeft(tl);
      if (tl.total <= 0) {
        clearInterval(timer);
        onExpired?.();
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [deadline, onExpired]);

  const fontSize = size === "sm" ? 18 : 34;
  const fontWeight = size === "sm" ? 500 : 500;

  if (timeLeft.total <= 0) {
    return (
      <span style={{ fontFamily: sf, fontSize, color: "var(--red)", fontWeight }}>
        Closed
      </span>
    );
  }

  const h = String(timeLeft.hours).padStart(2, "0");
  const m = String(timeLeft.minutes).padStart(2, "0");
  const s = String(timeLeft.seconds).padStart(2, "0");

  return (
    <span style={{
      fontFamily: sf, fontSize, fontWeight,
      color: "var(--white)", letterSpacing: size === "sm" ? "0.5px" : "-0.5px",
    }}>
      {h}
      <span style={{ color: "var(--muted-dim)", margin: "0 1px" }}>:</span>
      {m}
      <span style={{ color: "var(--muted-dim)", margin: "0 1px" }}>:</span>
      {s}
    </span>
  );
}

function getTimeLeft(deadline: number) {
  const now = Math.floor(Date.now() / 1000);
  const total = Math.max(0, deadline - now);
  return {
    total,
    hours: Math.floor(total / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  };
}

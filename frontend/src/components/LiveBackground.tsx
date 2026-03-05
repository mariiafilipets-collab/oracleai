import Image from "next/image";

export default function LiveBackground() {
  return (
    <div aria-hidden className="live-bg-wrap pointer-events-none">
      <div className="live-bg-image">
        <Image
          src="/images/oracleai-live-bg.png"
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover"
        />
      </div>
      <div className="live-bg-grid" />
      <div className="live-bg-orb live-bg-orb-cyan" />
      <div className="live-bg-orb live-bg-orb-purple" />
      <div className="live-bg-noise" />
    </div>
  );
}

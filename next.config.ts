import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    const pairs = [
      ['/from-tokyo/intercity', '/intercity'],
      ['/from-tokyo/intercity/hakone', '/intercity/hakone'],
      ['/from-tokyo/intercity/fuji', '/intercity/fuji'],
      ['/from-tokyo/intercity/kyoto-1', '/intercity/kyoto-1'],
      ['/from-tokyo/intercity/kyoto-2', '/intercity/kyoto-2'],
      ['/from-tokyo/intercity/kamakura', '/intercity/kamakura'],
      ['/from-tokyo/intercity/nara', '/intercity/nara'],
      ['/from-tokyo/intercity/nikko', '/intercity/nikko'],
      ['/from-tokyo/intercity/osaka', '/intercity/osaka'],
      ['/from-tokyo/intercity/enoshima', '/intercity/enoshima'],
      ['/from-tokyo/intercity/kanazawa', '/intercity/kanazawa'],
      ['/from-tokyo/intercity/himeji', '/intercity/himeji'],
      ['/from-tokyo/intercity/uji', '/intercity/uji'],
      ['/from-tokyo/intercity/private', '/intercity/private'],
      ['/from-tokyo/intercity/public', '/intercity/public'],
      ['/from-tokyo/city-tour', '/city-tour'],
      ['/from-tokyo/city-tour/day-one', '/city-tour/day-one'],
      ['/from-tokyo/city-tour/day-two', '/city-tour/day-two'],
      ['/from-tokyo/city-tour/hidden-spots', '/city-tour/hidden-spots'],
      ['/from-tokyo/city-tour/private', '/city-tour/private'],
      ['/from-tokyo/city-tour/public', '/city-tour/public'],
      ['/from-tokyo/multi-day', '/multi-day'],
    ];

    return pairs.map(([source, destination]) => ({
      source,
      destination,
      permanent: true,
    }));
  },
};

export default nextConfig;

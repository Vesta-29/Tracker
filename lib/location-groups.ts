import type { IslandGroup } from "@/lib/types";

export const islandGroups: IslandGroup[] = ["Luzon", "Visayas", "Mindanao"];

const islandGroupByRegionPrefix: Record<string, IslandGroup> = {
  "01": "Luzon", "02": "Luzon", "03": "Luzon", "04": "Luzon", "05": "Luzon", "13": "Luzon", "14": "Luzon", "17": "Luzon",
  "06": "Visayas", "07": "Visayas", "08": "Visayas", "18": "Visayas",
  "09": "Mindanao", "10": "Mindanao", "11": "Mindanao", "12": "Mindanao", "16": "Mindanao", "19": "Mindanao",
};

export function getIslandGroup(regionCode: string) {
  return islandGroupByRegionPrefix[regionCode.slice(0, 2)];
}

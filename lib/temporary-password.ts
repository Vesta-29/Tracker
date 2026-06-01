import { randomInt } from "node:crypto";

const passwordGroups = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnopqrstuvwxyz", "23456789", "!@#$%^&*"];
const passwordCharacters = passwordGroups.join("");

export function generateTemporaryPassword() {
  const characters = [...passwordGroups.map((group) => group[randomInt(group.length)]), ...Array.from({ length: 16 }, () => passwordCharacters[randomInt(passwordCharacters.length)])];
  for (let index = characters.length - 1; index > 0; index--) {
    const swap = randomInt(index + 1);
    [characters[index], characters[swap]] = [characters[swap], characters[index]];
  }
  return characters.join("");
}

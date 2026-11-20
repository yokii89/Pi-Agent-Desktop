import { describe, expect, it } from "vitest";
import { parseAccountProfile } from "./accountProfile";

describe("account display profiles", () => {
  it("keeps only bounded display fields from userinfo", () => {
    expect(
      parseAccountProfile({
        sub: "github|123",
        name: "  Yoki  ",
        nickname: "yoki89",
        picture: "https://avatars.githubusercontent.com/u/123?v=4",
        access_token: "not-display-data",
        email: "private@example.com",
      }),
    ).toEqual({
      subject: "github|123",
      name: "Yoki",
      picture: "https://avatars.githubusercontent.com/u/123?v=4",
    });
  });

  it("uses a nickname when a provider does not supply a display name", () => {
    expect(parseAccountProfile({ sub: "github|123", name: "  ", nickname: "yoki89" })).toEqual({
      subject: "github|123",
      name: "yoki89",
      picture: null,
    });
    expect(parseAccountProfile({ sub: "github|123" })?.name).toBe("github|123");
    expect(parseAccountProfile({ sub: "github|123", name: "a".repeat(300) })?.name).toHaveLength(
      256,
    );
  });

  it.each([null, [], {}, { sub: 123 }, { sub: " " }, { sub: "a".repeat(257) }])(
    "ignores profiles without a valid subject: %j",
    (value) => expect(parseAccountProfile(value)).toBeNull(),
  );

  it.each([
    "http://avatars.example/photo.png",
    "data:image/png;base64,photo",
    "file:///private/photo.png",
    "https://user:secret@avatars.example/photo.png",
    "not a URL",
    `https://avatars.example/${"a".repeat(2048)}`,
  ])("keeps the name when an avatar URL is unusable: %s", (picture) => {
    expect(parseAccountProfile({ sub: "github|123", name: "Yoki", picture })).toEqual({
      subject: "github|123",
      name: "Yoki",
      picture: null,
    });
  });
});

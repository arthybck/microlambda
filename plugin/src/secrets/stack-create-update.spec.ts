import { ISecretConfig } from "../config";

export const secrets: ISecretConfig[] = [
  {
    name: "$secret1",
    value: "$topSecret",
  },
  {
    name: "$secret2",
    value: "$superSecret",
    description: "My awesome description",
  },
  {
    name: "$secret3",
    value: "$superSecret",
    kmsKeyId: "arn://my-kms-key",
  },
  {
    name: "$secret4",
    value: "$superSecret",
    description: "My awesome description",
    kmsKeyId: "arn://my-kms-key",
  },
];

describe("[function] stackCreate", () => {
  it("should create/update secrets concurrently", async () => {
    expect(true).toBeFalsy();
  });
  it("should throw if any secret creation/update fails", async () => {
    expect(true).toBeFalsy();
  });
});

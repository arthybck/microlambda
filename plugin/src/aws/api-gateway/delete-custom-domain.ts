import { serviceName } from "./service-name";
import {
  ApiGatewayV2Client,
  DeleteDomainNameCommand,
  DeleteDomainNameRequest,
} from "@aws-sdk/client-apigatewayv2";
import { ILogger } from "../../types";
import { getCustomDomain } from "./get-custom-domain";

export const deleteCustomDomain = async (
  region: string,
  domainName: string,
  logger?: ILogger
): Promise<void> => {
  const client = new ApiGatewayV2Client({ region, maxAttempts: 5 });
  const exists = await getCustomDomain(region, domainName, logger);
  if (!exists) {
    logger?.info("Custom domain does not exists, nothing to delete");
    return;
  }
  const params: DeleteDomainNameRequest = {
    DomainName: domainName,
  };
  try {
    logger?.debug(serviceName, "DeleteDomainNameCommand", params);
    await client.send(new DeleteDomainNameCommand(params));
  } catch (e) {
    logger?.error(serviceName, "DeleteDomainNameCommand failed");
    logger?.error(e);
    throw e;
  }
};

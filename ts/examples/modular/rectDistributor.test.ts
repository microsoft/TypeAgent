import { RectDistributor } from "./rectDistributor.ts";
import { eventDistributorContract } from "./eventDistributor.contract.ts";

eventDistributorContract((region, locate) => new RectDistributor(region, locate));

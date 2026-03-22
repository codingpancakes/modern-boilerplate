import { Tracer } from "@aws-lambda-powertools/tracer";

const getServiceName = () => {
	const projectName = process.env.PROJECT_NAME || "local-dev";
	return `${projectName}-api`;
};

export const tracer = new Tracer({
	serviceName: getServiceName(),
});

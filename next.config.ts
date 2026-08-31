import baseConfig from "./next.config.jj-base";

const withAdminBasePath = { ...baseConfig, basePath: "/admin" };

export default withAdminBasePath;

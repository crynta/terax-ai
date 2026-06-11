use crate::modules::mcp::server_tools::McpToolProvider;

#[derive(Default)]
pub struct McpServerState {
    providers: Vec<Box<dyn McpToolProvider>>,
}

impl McpServerState {
    pub fn register(&mut self, provider: Box<dyn McpToolProvider>) {
        self.providers.push(provider);
    }

    pub fn all_tools(&self) -> Vec<crate::modules::mcp::server_tools::McpExposedTool> {
        self.providers.iter().flat_map(|p| p.tools()).collect()
    }
}

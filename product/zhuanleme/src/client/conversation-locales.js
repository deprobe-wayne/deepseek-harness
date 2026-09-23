/** Sidebar conversation lifecycle copy, merged into the product locale namespace. */
export const conversationZh = {
    conversations: '智能经营', manageConversations: '对话管理', archivedChats: '已归档对话', deletedChats: '已删除对话', deleteConversationTitle: '删除这条对话？', backToConversations: '返回对话', conversationView: '对话列表', activeConversations: '最近对话', archivedConversations: '已归档', deletedConversations: '已删除',
    conversationSearch: '搜索对话标题', conversationActions: '对话操作', archiveConversation: '归档', unarchiveConversation: '取消归档', deleteConversation: '移至已删除', restoreConversation: '恢复对话',
    deleteConversationConfirm: '确认移至已删除', deleteConversationHint: '对话将移至「已删除」，可以恢复。店铺账目、待确认草稿和原始对话记录都会保留。',
    emptyConversations: '暂无对话', emptyArchivedConversations: '暂无已归档对话', emptyDeletedConversations: '暂无已删除对话', noConversationMatches: '没有匹配的对话',
    moreConversations: '显示更多对话', conversationWorking: '处理中…', conversationRunning: 'AI 正在处理', conversationRunningHint: '等待处理完成或停止对话后，可移至已删除。',
    conversationStateLoading: '正在读取对话状态…', conversationStateError: '未能读取对话状态，请重试。', conversationRetry: '重试',
    archivedConversationHint: '归档保留对话记录，可随时取消归档。', deletedConversationHint: '此处保留可恢复的对话；店铺账目独立保存。',
};

/** English lifecycle copy has the same keys as the Chinese dictionary. */
export const conversationEn = {
    conversations: 'Smart operations', manageConversations: 'Manage conversations', archivedChats: 'Archived conversations', deletedChats: 'Deleted conversations', deleteConversationTitle: 'Delete this conversation?', backToConversations: 'Back to conversations', conversationView: 'Conversation list', activeConversations: 'Recent', archivedConversations: 'Archived', deletedConversations: 'Deleted',
    conversationSearch: 'Search conversation titles', conversationActions: 'Conversation actions', archiveConversation: 'Archive', unarchiveConversation: 'Unarchive', deleteConversation: 'Move to deleted', restoreConversation: 'Restore conversation',
    deleteConversationConfirm: 'Confirm move to deleted', deleteConversationHint: 'The conversation can be restored from Deleted. Shop entries, pending drafts, and the original conversation log will be kept.',
    emptyConversations: 'No conversations yet', emptyArchivedConversations: 'No archived conversations', emptyDeletedConversations: 'No deleted conversations', noConversationMatches: 'No matching conversations',
    moreConversations: 'Show more conversations', conversationWorking: 'Working…', conversationRunning: 'AI is working', conversationRunningHint: 'Wait for the conversation to finish or stop it before moving it to Deleted.',
    conversationStateLoading: 'Loading conversation status…', conversationStateError: 'Conversation status could not be loaded. Please retry.', conversationRetry: 'Retry',
    archivedConversationHint: 'Archived conversations keep their history and can be unarchived.', deletedConversationHint: 'These conversations can be restored. Shop entries are saved separately.',
};

Object.assign(conversationZh, { pinConversation: '置顶', unpinConversation: '取消置顶' });
Object.assign(conversationEn, { pinConversation: 'Pin', unpinConversation: 'Unpin' });

import useOnyx from '@hooks/useOnyx';
import {useSidebarOrderedReportsActions} from '@hooks/useSidebarOrderedReports';

import markAllMessagesAsRead from '@libs/actions/Report/MarkAllMessageAsRead';
import KeyboardShortcut from '@libs/KeyboardShortcut';

import CONST from '@src/CONST';
import ONYXKEYS from '@src/ONYXKEYS';

import {reportNameValuePairsArchivedSelector} from '@selectors/ReportNameValuePairs';
import {useEffect, useRef} from 'react';

function MarkAllMessagesAsReadHandler() {
    const [reportNameValuePairs] = useOnyx(ONYXKEYS.COLLECTION.REPORT_NAME_VALUE_PAIRS, {selector: reportNameValuePairsArchivedSelector});
    const {getReportIDsForTab} = useSidebarOrderedReportsActions();
    // The keyboard-shortcut callback below is registered once on mount, so keep the latest values in refs
    // for it to read at fire time instead of closing over a stale value.
    const reportNameValuePairsRef = useRef(reportNameValuePairs);
    const getReportIDsForTabRef = useRef(getReportIDsForTab);

    useEffect(() => {
        reportNameValuePairsRef.current = reportNameValuePairs;
    }, [reportNameValuePairs]);

    useEffect(() => {
        getReportIDsForTabRef.current = getReportIDsForTab;
    }, [getReportIDsForTab]);

    useEffect(() => {
        const shortcutConfig = CONST.KEYBOARD_SHORTCUTS.MARK_ALL_MESSAGES_AS_READ;
        const unsubscribe = KeyboardShortcut.subscribe(
            shortcutConfig.shortcutKey,
            () => {
                // Same unread ids the Inbox tab uses, so the shortcut cannot mark chats the list filtered out.
                markAllMessagesAsRead(reportNameValuePairsRef.current, getReportIDsForTabRef.current(CONST.INBOX_TAB.UNREAD));
            },
            shortcutConfig.descriptionKey,
            shortcutConfig.modifiers,
            true,
        );

        return () => unsubscribe();
        // Rule disabled because this effect is only for component did mount & will component unmount lifecycle event
    }, []);

    return null;
}

export default MarkAllMessagesAsReadHandler;

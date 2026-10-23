#include "TestNetworkIsolation.h"
#include <SystemConfiguration/SystemConfiguration.h>
#include <sandbox.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int isolated = 0;
static int first_proxy_port = 0;

static void block_proxy_port(char *profile, size_t capacity, int port) {
    if (port <= 0 || port > 65535) return;
    if (!first_proxy_port) first_proxy_port = port;
    size_t used = strlen(profile);
    int length = snprintf(profile + used, capacity - used,
        "(deny network-outbound (remote ip \"localhost:%d\"))", port);
    if (length < 0 || (size_t)length >= capacity - used) abort();
}

// This object is linked only into the XCTest bundle. The loader runs this before
// any test, including filtered runs; the restriction also applies to child processes.
__attribute__((constructor))
static void isolate_test_network(void) {
    char profile[8192] =
        "(version 1)"
        "(allow default)"
        "(deny network*)"
        "(allow network-bind (local ip \"localhost:*\"))"
        "(allow network-inbound (local ip \"localhost:*\"))"
        "(allow network* (remote ip \"localhost:*\"))";
    // A loopback proxy can forward a public URL outside this process. Deny its
    // port too, without changing the user's system or environment configuration.
    CFDictionaryRef proxies = SCDynamicStoreCopyProxies(NULL);
    if (proxies) {
        const CFStringRef keys[] = { kSCPropNetProxiesHTTPPort, kSCPropNetProxiesHTTPSPort,
                                    kSCPropNetProxiesSOCKSPort, kSCPropNetProxiesFTPPort };
        for (size_t i = 0; i < sizeof(keys) / sizeof(keys[0]); i++) {
            CFTypeRef value = CFDictionaryGetValue(proxies, keys[i]);
            int port = 0;
            if (value && CFGetTypeID(value) == CFNumberGetTypeID()
                && CFNumberGetValue(value, kCFNumberIntType, &port)) {
                block_proxy_port(profile, sizeof(profile), port);
            }
        }
        CFRelease(proxies);
    }
    const char *variables[] = { "http_proxy", "https_proxy", "all_proxy",
                               "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY" };
    for (size_t i = 0; i < sizeof(variables) / sizeof(variables[0]); i++) {
        const char *value = getenv(variables[i]);
        if (!value || !*value) continue;
        CFURLRef url = CFURLCreateWithBytes(NULL, (const UInt8 *)value, strlen(value),
                                           kCFStringEncodingUTF8, NULL);
        if (url) {
            int port = CFURLGetPortNumber(url);
            if (port == -1) port = strncmp(value, "https:", 6) == 0 ? 443
                : strncmp(value, "socks", 5) == 0 ? 1080 : 80;
            block_proxy_port(profile, sizeof(profile), port);
            CFRelease(url);
        }
    }
    char *error = NULL;
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
    int result = sandbox_init(profile, 0, &error);
    if (result != 0) {
        fprintf(stderr, "NotchSPI tests refused to start: network isolation failed: %s\n",
                error ? error : "unknown sandbox error");
        sandbox_free_error(error);
        abort();
    }
#pragma clang diagnostic pop
    isolated = 1;
}

int nspi_test_network_isolated(void) {
    return isolated;
}

int nspi_test_blocked_proxy_port(void) {
    return first_proxy_port;
}

/**
 * LD_PRELOAD Network Interception Shim for D-Shield
 *
 * Layer 3 of the 4-layer network interception stack.
 * Intercepts libc network calls and redirects them through the D-Shield proxy.
 *
 * Compile: gcc -shared -fPIC -o libdshield.so ld-preload-shim.c -ldl
 * Use: LD_PRELOAD=/path/to/libdshield.so DSHIELD_PROXY_HOST=127.0.0.1 DSHIELD_PROXY_PORT=8080 ./program
 */

#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <dlfcn.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <netdb.h>
#include <unistd.h>
#include <errno.h>

/* Original function pointers */
static int (*original_connect)(int, const struct sockaddr *, socklen_t) = NULL;
static int (*original_socket)(int, int, int) = NULL;
static ssize_t (*original_send)(int, const void *, size_t, int) = NULL;
static ssize_t (*original_sendto)(int, const void *, size_t, int, const struct sockaddr *, socklen_t) = NULL;
static struct hostent *(*original_gethostbyname)(const char *) = NULL;
static int (*original_getaddrinfo)(const char *, const char *, const struct addrinfo *, struct addrinfo **) = NULL;

/* Proxy configuration from environment */
static char *proxy_host = NULL;
static int proxy_port = 0;
static int initialized = 0;
static int debug_mode = 0;

/* Log file for intercepted calls */
static FILE *log_file = NULL;

/**
 * Initialize the shim by loading original functions and reading config.
 */
static void initialize(void) {
    if (initialized) return;

    /* Load original functions */
    original_connect = dlsym(RTLD_NEXT, "connect");
    original_socket = dlsym(RTLD_NEXT, "socket");
    original_send = dlsym(RTLD_NEXT, "send");
    original_sendto = dlsym(RTLD_NEXT, "sendto");
    original_gethostbyname = dlsym(RTLD_NEXT, "gethostbyname");
    original_getaddrinfo = dlsym(RTLD_NEXT, "getaddrinfo");

    /* Read proxy config from environment */
    proxy_host = getenv("DSHIELD_PROXY_HOST");
    char *port_str = getenv("DSHIELD_PROXY_PORT");
    if (port_str) {
        proxy_port = atoi(port_str);
    }

    /* Debug mode */
    char *debug_str = getenv("DSHIELD_DEBUG");
    if (debug_str && strcmp(debug_str, "1") == 0) {
        debug_mode = 1;
    }

    /* Log file */
    char *log_path = getenv("DSHIELD_LOG_FILE");
    if (log_path) {
        log_file = fopen(log_path, "a");
    }

    initialized = 1;

    if (debug_mode) {
        fprintf(stderr, "[DSHIELD] Initialized: proxy=%s:%d\n",
                proxy_host ? proxy_host : "none", proxy_port);
    }
}

/**
 * Log an intercepted connection attempt.
 */
static void log_connection(const char *dest_host, int dest_port, int allowed) {
    if (!log_file && !debug_mode) return;

    const char *status = allowed ? "ALLOWED" : "BLOCKED";
    char msg[256];
    snprintf(msg, sizeof(msg), "[DSHIELD] %s: %s:%d\n", status, dest_host, dest_port);

    if (debug_mode) {
        fprintf(stderr, "%s", msg);
    }

    if (log_file) {
        fprintf(log_file, "%s", msg);
        fflush(log_file);
    }
}

/**
 * Check if destination should be allowed (proxy or localhost).
 */
static int is_allowed_destination(const struct sockaddr *addr) {
    if (!addr) return 1;

    if (addr->sa_family == AF_INET) {
        struct sockaddr_in *addr_in = (struct sockaddr_in *)addr;
        char ip_str[INET_ADDRSTRLEN];
        inet_ntop(AF_INET, &addr_in->sin_addr, ip_str, sizeof(ip_str));
        int port = ntohs(addr_in->sin_port);

        /* Always allow localhost */
        if (strcmp(ip_str, "127.0.0.1") == 0 || strcmp(ip_str, "0.0.0.0") == 0) {
            return 1;
        }

        /* Allow proxy host:port */
        if (proxy_host && proxy_port > 0) {
            if (strcmp(ip_str, proxy_host) == 0 && port == proxy_port) {
                return 1;
            }
        }

        log_connection(ip_str, port, 0);
        return 0;
    }

    if (addr->sa_family == AF_INET6) {
        struct sockaddr_in6 *addr_in6 = (struct sockaddr_in6 *)addr;
        char ip_str[INET6_ADDRSTRLEN];
        inet_ntop(AF_INET6, &addr_in6->sin6_addr, ip_str, sizeof(ip_str));
        int port = ntohs(addr_in6->sin6_port);

        /* Allow localhost IPv6 */
        if (strcmp(ip_str, "::1") == 0 || strcmp(ip_str, "::") == 0) {
            return 1;
        }

        log_connection(ip_str, port, 0);
        return 0;
    }

    /* Allow Unix domain sockets */
    if (addr->sa_family == AF_UNIX) {
        return 1;
    }

    return 1;
}

/**
 * Intercepted connect() - blocks non-proxy connections.
 */
int connect(int sockfd, const struct sockaddr *addr, socklen_t addrlen) {
    initialize();

    if (!original_connect) {
        original_connect = dlsym(RTLD_NEXT, "connect");
    }

    if (!is_allowed_destination(addr)) {
        errno = EACCES;
        return -1;
    }

    return original_connect(sockfd, addr, addrlen);
}

/**
 * Intercepted socket() - allows all socket creation but logs it.
 */
int socket(int domain, int type, int protocol) {
    initialize();

    if (!original_socket) {
        original_socket = dlsym(RTLD_NEXT, "socket");
    }

    if (debug_mode) {
        fprintf(stderr, "[DSHIELD] socket(domain=%d, type=%d, protocol=%d)\n",
                domain, type, protocol);
    }

    return original_socket(domain, type, protocol);
}

/**
 * Intercepted sendto() - blocks if destination not allowed.
 */
ssize_t sendto(int sockfd, const void *buf, size_t len, int flags,
               const struct sockaddr *dest_addr, socklen_t addrlen) {
    initialize();

    if (!original_sendto) {
        original_sendto = dlsym(RTLD_NEXT, "sendto");
    }

    if (dest_addr && !is_allowed_destination(dest_addr)) {
        errno = EACCES;
        return -1;
    }

    return original_sendto(sockfd, buf, len, flags, dest_addr, addrlen);
}

/**
 * Constructor - called when library is loaded.
 */
__attribute__((constructor))
static void dshield_init(void) {
    initialize();
}

/**
 * Destructor - called when library is unloaded.
 */
__attribute__((destructor))
static void dshield_cleanup(void) {
    if (log_file) {
        fclose(log_file);
        log_file = NULL;
    }
}

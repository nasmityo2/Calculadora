class AuthUser {
  const AuthUser({
    required this.username,
    this.fullName,
    required this.email,
    required this.role,
  });

  final String username;
  final String? fullName;
  final String email;
  final String role;

  factory AuthUser.fromJson(Map<String, dynamic> json) {
    return AuthUser(
      username: json['username'] as String,
      fullName: json['fullName'] as String?,
      email: json['email'] as String,
      role: json['role'] as String,
    );
  }

  String get displayName => fullName ?? username;
}

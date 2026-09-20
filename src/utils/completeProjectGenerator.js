// Generador de proyecto Spring Boot completo
import { generateCode } from './codeGenerator.js';

export const generateCompleteProject = async (nodes, edges, projectName = 'UMLGeneratedProject') => {
  try {
    // Filtrar nodos válidos para generación de código (excluir nodos de sistema)
    const validNodes = nodes.filter(node => {
      // Excluir puntos de conexión de clases de asociación
      if (node.data?.isConnectionPoint) return false;
      
      // Excluir notas (comentarios)
      if (node.data?.isNote) return false;
      
      // Incluir solo nodos con className válido
      return node.data?.className && node.data.className.trim() !== '';
    });
    
    // Validar que tengamos nodos válidos para generar código
    if (validNodes.length === 0) {
      throw new Error('No hay clases válidas para generar código. Asegúrate de que tus clases tengan nombres válidos.');
    }

    // Generar código base con nodos filtrados y validaciones ya incluidas
    const baseResult = generateCode(validNodes, edges, true);
    
    // Debug info removed: summary of baseResult (was logging models/repositories/services/controllers)
    
    // Importar JSZip dinámicamente
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();

    // Nombre del proyecto para archivos
    const artifactId = projectName.toLowerCase().replace(/\s+/g, '-');
    const className = projectName.replace(/\s+/g, '');
    
    // 1. pom.xml
    const pomXml = `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0" 
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 
         https://maven.apache.org/xsd/maven-4.0.0.xsd">
    <modelVersion>4.0.0</modelVersion>
    <parent>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-parent</artifactId>
        <version>3.2.0</version>
        <relativePath/>
    </parent>
    
    <groupId>com.generated</groupId>
    <artifactId>${artifactId}</artifactId>
    <version>1.0.0</version>
    <name>${projectName}</name>
    <description>Generated Spring Boot project from UML diagram</description>
    
    <properties>
        <java.version>17</java.version>
    </properties>
    
    <dependencies>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-web</artifactId>
        </dependency>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-data-jpa</artifactId>
        </dependency>
        <dependency>
            <groupId>com.h2database</groupId>
            <artifactId>h2</artifactId>
            <scope>runtime</scope>
        </dependency>
        <dependency>
            <groupId>org.projectlombok</groupId>
            <artifactId>lombok</artifactId>
            <optional>true</optional>
        </dependency>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-test</artifactId>
            <scope>test</scope>
        </dependency>
    </dependencies>
    
    <build>
        <plugins>
            <plugin>
                <groupId>org.springframework.boot</groupId>
                <artifactId>spring-boot-maven-plugin</artifactId>
                <configuration>
                    <excludes>
                        <exclude>
                            <groupId>org.projectlombok</groupId>
                            <artifactId>lombok</artifactId>
                        </exclude>
                    </excludes>
                </configuration>
            </plugin>
        </plugins>
    </build>
</project>`;

    // 2. application.yml
    const applicationYml = `server:
  port: 8080

spring:
  datasource:
    url: jdbc:h2:mem:testdb
    driver-class-name: org.h2.Driver
    username: sa
    password: password
  
  jpa:
    database-platform: org.hibernate.dialect.H2Dialect
    hibernate:
      ddl-auto: create-drop
    show-sql: true
    properties:
      hibernate:
        format_sql: true
  
  h2:
    console:
      enabled: true
      path: /h2-console

logging:
  level:
    org.hibernate.SQL: DEBUG
    org.hibernate.type.descriptor.sql.BasicBinder: TRACE`;

    // 3. Clase principal
    const mainClass = `package com.generated;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class ${className}Application {
    public static void main(String[] args) {
        SpringApplication.run(${className}Application.class, args);
    }
}`;

    // 4. README.md
    const readme = `# ${projectName}

Generated Spring Boot 3.2 project from UML diagram.

## 🚀 Cómo ejecutar

1. Asegúrate de tener **Java 17+** y **Maven** instalados
2. Ejecuta el proyecto:
   \`\`\`bash
   mvn spring-boot:run
   \`\`\`
3. Accede a la aplicación:
   - **API Base URL**: http://localhost:8080/api
   - **H2 Console**: http://localhost:8080/h2-console

## 🗄️ Base de datos H2

- **JDBC URL**: jdbc:h2:mem:testdb
- **Username**: sa
- **Password**: password

## 📋 Entidades generadas

${baseResult.models.map(m => `- **${m.className}**`).join('\n')}

## 📡 Endpoints REST disponibles

${baseResult.models.map(m => `
### ${m.className}
- \`GET /api/${m.className.toLowerCase()}\` - Obtener todos los ${m.className.toLowerCase()}s
- \`GET /api/${m.className.toLowerCase()}/{id}\` - Obtener ${m.className.toLowerCase()} por ID
- \`POST /api/${m.className.toLowerCase()}\` - Crear nuevo ${m.className.toLowerCase()}
- \`PUT /api/${m.className.toLowerCase()}/{id}\` - Actualizar ${m.className.toLowerCase()}
- \`DELETE /api/${m.className.toLowerCase()}/{id}\` - Eliminar ${m.className.toLowerCase()}`).join('\n')}

## 🛠️ Tecnologías utilizadas

- **Java 17**
- **Spring Boot 3.2.0**
- **Spring Data JPA**
- **H2 Database**
- **Lombok**
- **Maven**

## ✅ Listo para usar

Este proyecto está **100% funcional** y listo para ejecutar. Las entidades, repositorios, servicios y controladores ya están configurados y funcionando.
`;

    // 5. .gitignore
    const gitignore = `# Compiled class files
*.class

# Package Files
*.jar
*.war
*.ear

# Maven
target/
pom.xml.tag
pom.xml.releaseBackup
pom.xml.versionsBackup
pom.xml.next
release.properties
dependency-reduced-pom.xml
buildNumber.properties
.mvn/timing.properties
.mvn/wrapper/maven-wrapper.jar

# IDE
.idea/
*.iml
*.ipr
.vscode/
.settings/
.project
.classpath

# OS
.DS_Store
Thumbs.db

# H2 Database files
*.db
*.mv.db
*.trace.db

# Logs
*.log`;

    // Añadir archivos de configuración al ZIP
    zip.file('pom.xml', pomXml);
    zip.file('src/main/resources/application.yml', applicationYml);
    zip.file(`src/main/java/com/generated/${className}Application.java`, mainClass);
    zip.file('README.md', readme);
    zip.file('.gitignore', gitignore);

    // Añadir código generado (con imports corregidos a Jakarta)
  // console.log('🔍 Añadiendo modelos al ZIP...');
    if (baseResult.models && baseResult.models.length > 0) {
      baseResult.models.forEach(model => {
  // console.log(`  📄 Añadiendo: ${model.className}.java`);
        const javaCode = model.code.replace(/javax\.persistence/g, 'jakarta.persistence');
        zip.file(`src/main/java/com/generated/entities/${model.className}.java`, javaCode);
      });
    } else {
      console.warn('⚠️ No hay modelos para añadir');
    }

  // console.log('🔍 Añadiendo repositorios al ZIP...');
    if (baseResult.repositories && baseResult.repositories.length > 0) {
      baseResult.repositories.forEach(repo => {
  // console.log(`  📄 Añadiendo: ${repo.className}Repository.java`);
        zip.file(`src/main/java/com/generated/repositories/${repo.className}Repository.java`, repo.code);
      });
    } else {
      console.warn('⚠️ No hay repositorios para añadir');
    }

  // console.log('🔍 Añadiendo servicios al ZIP...');
    if (baseResult.services && baseResult.services.length > 0) {
      baseResult.services.forEach(service => {
  // console.log(`  📄 Añadiendo: ${service.className}Service.java`);
        zip.file(`src/main/java/com/generated/services/${service.className}Service.java`, service.code);
      });
    } else {
      console.warn('⚠️ No hay servicios para añadir');
    }

  // console.log('🔍 Añadiendo controladores al ZIP...');
    if (baseResult.controllers && baseResult.controllers.length > 0) {
      baseResult.controllers.forEach(controller => {
  // console.log(`  📄 Añadiendo: ${controller.className}Controller.java`);
        zip.file(`src/main/java/com/generated/controllers/${controller.className}Controller.java`, controller.code);
      });
    } else {
      console.warn('⚠️ No hay controladores para añadir');
    }

    // Crear directorios vacíos necesarios
    zip.folder('src/test/java/com/generated');
    zip.folder('src/main/resources/static');
    zip.folder('src/main/resources/templates');

    // Generar y descargar ZIP
    const zipBlob = await zip.generateAsync({ 
      type: 'blob',
      comment: `Generated Spring Boot project: ${projectName}`
    });
    
    const { saveAs } = await import('file-saver');
    const fileName = `${artifactId}-spring-boot-project.zip`;
    saveAs(zipBlob, fileName);

    return {
      success: true,
      message: `✅ Proyecto ${projectName} generado y descargado exitosamente`,
      fileName,
      entities: baseResult.models.length,
      files: 5 + baseResult.models.length + baseResult.repositories.length + baseResult.services.length + baseResult.controllers.length,
      details: {
        entities: baseResult.models.map(m => m.className),
        springBootVersion: '3.2.0',
        javaVersion: '17',
        database: 'H2 (in-memory)'
      }
    };

  } catch (error) {
    console.error('❌ Error generando proyecto completo:', error);
    console.error('❌ Stack trace:', error.stack);
    throw new Error(`Error en generateCompleteProject: ${error.message}`);
  }
};